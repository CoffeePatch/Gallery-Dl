const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let mode = 'check';
let inputFile = 'accounts.txt';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
        mode = args[i + 1];
        i++;
    } else if (args[i] === '--file' && args[i + 1]) {
        inputFile = args[i + 1];
        i++;
    }
}

// Fallback to users.txt if accounts.txt doesn't exist and users.txt does
if (inputFile === 'accounts.txt' && !fs.existsSync('accounts.txt') && fs.existsSync('users.txt')) {
    inputFile = 'users.txt';
    console.log(`⚠️  accounts.txt not found. Falling back to users.txt`);
}

const AUTH_FILE = 'auth.json';
const OUTPUT_FILE = 'results.csv';
const BATCH_SIZE = 150;
const MACRO_DELAY_MS = 15 * 60 * 1000; // 15 mins
const TIMEOUT_MS = 15000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseHandle(line) {
    let handle = line.trim();
    if (!handle || handle.startsWith('#')) return null;
    
    let extracted = null;
    
    // Extract handle from full url, gracefully handling /status, ?lang=en, etc.
    const urlMatch = handle.match(/^(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[\/?#]|$)/i);
    if (urlMatch) {
        extracted = urlMatch[1];
    } else {
        handle = handle.replace(/^@/, '');
        if (/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
            extracted = handle;
        }
    }

    if (extracted) {
        // Ignore system paths that aren't actual user profiles
        const blacklist = ['search', 'home', 'explore', 'i', 'notifications', 'messages', 'settings', 'intent', 'login', 'logout'];
        if (blacklist.includes(extracted.toLowerCase())) {
            return null;
        }
        return extracted;
    }
    
    return null;
}

function loadCookiesFromTxt(txtPath) {
    const lines = fs.readFileSync(txtPath, 'utf8').split('\n');
    const cookies = [];
    lines.forEach(line => {
        if (line.trim() === '' || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) return;
        let t = line;
        if (t.startsWith('#HttpOnly_')) t = t.substring(10);
        const parts = t.split('\t');
        if (parts.length >= 7) {
            cookies.push({
                domain: parts[0],
                path: parts[2],
                secure: parts[3] === 'TRUE',
                expires: parseInt(parts[4]) || -1,
                name: parts[5],
                value: parts[6].trim()
            });
        }
    });
    return { cookies, origins: [] };
}

async function doAuth() {
    console.log('🚀 Starting AUTH mode...');
    let browser;
    try {
        // Try launching actual Google Chrome to bypass "Browser not secure" blocks
        browser = await chromium.launch({ headless: false, channel: 'chrome' });
        console.log('✅ Launched using local Google Chrome.');
    } catch (e) {
        try {
            // Fallback to Microsoft Edge
            browser = await chromium.launch({ headless: false, channel: 'msedge' });
            console.log('✅ Launched using local Microsoft Edge.');
        } catch (e2) {
            // Fallback to bundled Chromium
            browser = await chromium.launch({ headless: false });
            console.log('⚠️ Launched using bundled Chromium (May trigger bot detection).');
        }
    }
    
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Navigate to https://x.com/login and please log in manually.');
    console.log('Once you are fully logged in and see your home feed, close the browser window to save the session.');
    
    await page.goto('https://x.com/login');
    
    // Wait for the page to close
    await new Promise(resolve => {
        page.on('close', resolve);
    });

    // Save auth state
    await context.storageState({ path: AUTH_FILE });
    console.log(`✅ Session saved to ${AUTH_FILE}`);
    await browser.close();
}

async function appendCsv(handle, status, postCount) {
    const timestamp = new Date().toISOString();
    const row = `${handle},"${status}","${postCount}","${timestamp}"\n`;
    fs.appendFileSync(OUTPUT_FILE, row);
}

async function checkAccount(page, handle) {
    console.log(`\n🔍 Checking @${handle}...`);
    try {
        const response = await page.goto(`https://x.com/${handle}`, { timeout: TIMEOUT_MS, waitUntil: 'domcontentloaded' });
        
        // Let JS render
        await page.waitForTimeout(2000); 

        const url = page.url();
        if (url.includes('/i/flow/login') || url.includes('twitter.com/login')) {
            console.error('🚨 CRITICAL: Redirected to login screen. Session may be expired or rate-limited.');
            return { status: 'AUTH_WARNING' };
        }

        const bodyText = await page.evaluate(() => document.body.innerText);

        if (bodyText.includes('Rate limit exceeded')) {
            console.error('🚨 CRITICAL: Rate limit exceeded page detected.');
            return { status: 'RATE_LIMIT' };
        }

        if (bodyText.includes('Account suspended')) {
            return { status: 'Suspended', postCount: 'N/A' };
        }
        
        if (bodyText.includes('This account doesn’t exist') || bodyText.includes('This account does not exist')) {
            return { status: 'Does not exist', postCount: 'N/A' };
        }

        // Wait a bit more for timeline or profile header to fully load if it looks active
        try {
            await page.waitForSelector('[data-testid="primaryColumn"]', { timeout: 5000 });
        } catch(e) {
            // ignore
        }

        const updatedBodyText = await page.evaluate(() => document.body.innerText);
        
        if (updatedBodyText.includes('Account suspended')) {
            return { status: 'Suspended', postCount: 'N/A' };
        }

        // Extract post count
        const postsMatch = updatedBodyText.match(/([\d,.]+[KMB]?)\s+(?:posts|Posts)/);
        let postCount = '0';
        
        if (postsMatch && postsMatch[1]) {
            postCount = postsMatch[1];
        } else {
            // Sometimes it's structured differently, let's try to find it specifically in the header
            const headerPostText = await page.evaluate(() => {
                const header = document.querySelector('[data-testid="primaryColumn"] header');
                if (header) {
                    const match = header.innerText.match(/([\d,.]+[KMB]?)\s+(?:posts|Posts)/);
                    return match ? match[1] : null;
                }
                return null;
            });
            if (headerPostText) {
                postCount = headerPostText;
            }
        }

        if (postCount === '0' || postCount === '0 posts' || updatedBodyText.includes('posts will appear here') || updatedBodyText.includes('hasn’t posted yet')) {
            return { status: 'Active (No posts)', postCount: '0' };
        }

        return { status: `Active (${postCount} posts)`, postCount: postCount };

    } catch (e) {
        if (e.name === 'TimeoutError' || e.message.includes('ERR_')) {
            console.warn(`⚠️  Timeout/Network Error for @${handle}: ${e.message.split('\\n')[0]}`);
            return { status: 'Timeout/Network Error', postCount: 'N/A' };
        }
        console.error(`❌ Unexpected Error on @${handle}:`, e);
        return { status: 'Error', postCount: 'N/A' };
    }
}

async function doCheck() {
    let storageState = null;

    if (fs.existsSync(AUTH_FILE)) {
        storageState = AUTH_FILE;
    } else if (fs.existsSync('cookies.txt')) {
        console.log('🍪 Detected cookies.txt! Automatically converting and using it for authentication.');
        const state = loadCookiesFromTxt('cookies.txt');
        fs.writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2));
        storageState = AUTH_FILE;
    } else {
        console.error(`❌ Missing ${AUTH_FILE} and cookies.txt. Please run with '--mode auth' first.`);
        process.exit(1);
    }

    if (!fs.existsSync(inputFile)) {
        console.error(`❌ Input file ${inputFile} not found.`);
        process.exit(1);
    }

    // Initialize CSV and check for existing completed handles
    let completedHandles = new Set();
    if (!fs.existsSync(OUTPUT_FILE)) {
        fs.writeFileSync(OUTPUT_FILE, 'Handle,Status,Post Count,Timestamp\n');
    } else {
        const existingCsv = fs.readFileSync(OUTPUT_FILE, 'utf8').split('\n');
        // skip header row
        for (let i = 1; i < existingCsv.length; i++) {
            const line = existingCsv[i].trim();
            if (!line) continue;
            // Simple split: handle is always before the first comma
            const handle = line.split(',')[0];
            const status = line.split(',')[1];
            
            // If the script logged a network error, we WANT to retry it.
            // If it logged any valid status (Active, Suspended, etc), skip it.
            if (status && !status.includes('Timeout/Network Error') && !status.includes('Error')) {
                completedHandles.add(handle);
            }
        }
    }

    const lines = fs.readFileSync(inputFile, 'utf8').split('\n');
    let handles = [...new Set(lines.map(parseHandle).filter(h => h))];

    const initialCount = handles.length;
    handles = handles.filter(h => !completedHandles.has(h));

    console.log(`📦 Loaded ${initialCount} unique accounts from ${inputFile}`);
    if (initialCount - handles.length > 0) {
        console.log(`⏭️  Resuming progress: Skipping ${initialCount - handles.length} already completed accounts.`);
    }
    
    if (handles.length === 0) {
        console.log(`\n🎉 All accounts are already processed!`);
        process.exit(0);
    }

    let currentIndex = 0;
    const batchResults = [];

    while (currentIndex < handles.length) {
        const batch = handles.slice(currentIndex, currentIndex + BATCH_SIZE);
        console.log(`\n=== 🚀 Starting Batch ${Math.floor(currentIndex / BATCH_SIZE) + 1} (${batch.length} accounts) ===`);

        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ storageState: AUTH_FILE });
        const page = await context.newPage();

        let batchCanceled = false;

        for (let i = 0; i < batch.length; i++) {
            const handle = batch[i];
            const result = await checkAccount(page, handle);

            if (result.status === 'AUTH_WARNING' || result.status === 'RATE_LIMIT') {
                batchCanceled = true;
                break;
            }

            console.log(`   -> [${result.status}]`);
            await appendCsv(handle, result.status, result.postCount);
            
            batchResults.push({ handle, status: result.status });

            // Micro-delay: 3s + random 0-3s
            if (i < batch.length - 1) {
                const delay = 3000 + Math.floor(Math.random() * 3000);
                console.log(`   ⏳ Sleeping for ${(delay/1000).toFixed(2)}s...`);
                await sleep(delay);
            }
        }

        await browser.close();

        if (batchCanceled) {
            console.error('\n🛑 Script aborted early due to Rate Limit or Auth issues to protect your account.');
            process.exit(1);
        }

        currentIndex += BATCH_SIZE;

        // Print Summary
        console.log(`\n📊 BATCH SUMMARY`);
        console.table(
            batchResults.reduce((acc, curr) => {
                acc[curr.status] = (acc[curr.status] || 0) + 1;
                return acc;
            }, {})
        );
        batchResults.length = 0; // reset for next batch

        // Macro-delay if more accounts remain
        if (currentIndex < handles.length) {
            console.log(`\n💤 Batch complete. Macro-delaying for 15 minutes to reset X limits...`);
            let remainingSeconds = MACRO_DELAY_MS / 1000;
            const interval = setInterval(() => {
                remainingSeconds--;
                if (remainingSeconds % 60 === 0 && remainingSeconds > 0) {
                    console.log(`   ⏱️  ${remainingSeconds / 60} minutes remaining...`);
                }
            }, 1000);

            await sleep(MACRO_DELAY_MS);
            clearInterval(interval);
        }
    }

    console.log(`\n🎉 All done! Processed ${handles.length} accounts. Results saved to ${OUTPUT_FILE}`);
}

(async () => {
    if (mode === 'auth') {
        await doAuth();
    } else {
        await doCheck();
    }
})();
