const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { USERS_FILE, COOKIES_FILE, AUTH_FILE, X_CHECK_OUTPUT } = require('./paths');
const {
    X_CHECKER_NAV_DELAY_MS,
    X_CHECKER_PACING_MIN_MS,
    X_CHECKER_PACING_MAX_MS,
    X_CHECKER_BATCH_WAIT_MS
} = require('./rateLimits');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function parseHandle(line) {
    let handle = line.trim();
    if (!handle || handle.startsWith('#')) return null;
    const urlMatch = handle.match(/^(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[\/?#]|$)/i);
    if (urlMatch) return urlMatch[1];
    handle = handle.replace(/^@/, '');
    return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
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

async function runXCheckerAuth() {
    console.log('🚀 Starting AUTH mode...');
    let browser;
    try {
        browser = await chromium.launch({ headless: false, channel: 'chrome' });
        console.log('   Launched using local Google Chrome.');
    } catch (e) {
        try {
            browser = await chromium.launch({ headless: false, channel: 'msedge' });
            console.log('   Launched using local Microsoft Edge.');
        } catch (e2) {
            browser = await chromium.launch({ headless: false });
            console.log('   Launched using bundled Chromium.');
        }
    }
    
    const context = await browser.newContext();
    const page = await context.newPage();
    console.log('   Navigate to https://x.com/login and please log in manually.');
    console.log('   Once you are fully logged in and see your home feed, close the browser window to save the session.');
    
    await page.goto('https://x.com/login');
    await new Promise(resolve => page.on('close', resolve));

    await context.storageState({ path: AUTH_FILE });
    console.log(`✅ Session saved to ${AUTH_FILE}`);
    await browser.close();
}

async function checkAccount(page, handle) {
    console.log(`🔍 Checking @${handle}...`);
    try {
        await page.goto(`https://x.com/${handle}`, { timeout: 15000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(X_CHECKER_NAV_DELAY_MS); 

        const url = page.url();
        if (url.includes('/i/flow/login') || url.includes('twitter.com/login')) {
            return { status: 'AUTH_WARNING' };
        }

        const bodyText = await page.evaluate(() => document.body.innerText);
        if (bodyText.includes('Rate limit exceeded')) return { status: 'RATE_LIMIT' };
        if (bodyText.includes('Account suspended')) return { status: 'Suspended', postCount: 'N/A' };
        if (bodyText.includes('This account doesn’t exist') || bodyText.includes('This account does not exist')) {
            return { status: 'Does not exist', postCount: 'N/A' };
        }

        try {
            await page.waitForSelector('[data-testid="primaryColumn"]', { timeout: 5000 });
        } catch(e) {}

        const updatedBodyText = await page.evaluate(() => document.body.innerText);
        if (updatedBodyText.includes('Account suspended')) return { status: 'Suspended', postCount: 'N/A' };

        const postsMatch = updatedBodyText.match(/([\d,.]+[KMB]?)\s+(?:posts|Posts)/);
        let postCount = '0';
        if (postsMatch && postsMatch[1]) {
            postCount = postsMatch[1];
        } else {
            const headerPostText = await page.evaluate(() => {
                const header = document.querySelector('[data-testid="primaryColumn"] header');
                if (header) {
                    const match = header.innerText.match(/([\d,.]+[KMB]?)\s+(?:posts|Posts)/);
                    return match ? match[1] : null;
                }
                return null;
            });
            if (headerPostText) postCount = headerPostText;
        }

        if (postCount === '0' || postCount === '0 posts' || updatedBodyText.includes('posts will appear here') || updatedBodyText.includes('hasn’t posted yet')) {
            return { status: 'Active (No posts)', postCount: '0' };
        }
        return { status: `Active (${postCount} posts)`, postCount: postCount };
    } catch (e) {
        if (e.name === 'TimeoutError' || e.message.includes('ERR_')) {
            return { status: 'Timeout/Network Error', postCount: 'N/A' };
        }
        return { status: 'Error', postCount: 'N/A' };
    }
}

async function runXCheckerScan() {
    console.log('\n==================================================');
    console.log('       X/Twitter Account Status Checker');
    console.log(` Input File  : ${USERS_FILE}`);
    console.log(` Output CSV  : ${X_CHECK_OUTPUT}`);
    console.log('==================================================\n');

    let storageState = null;
    if (fs.existsSync(AUTH_FILE)) {
        storageState = AUTH_FILE;
    } else if (fs.existsSync(COOKIES_FILE)) {
        console.log(`🍪 Automatically converting cookies.txt for authentication.`);
        const state = loadCookiesFromTxt(COOKIES_FILE);
        const settingsDir = path.dirname(AUTH_FILE);
        if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
        fs.writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2));
        storageState = AUTH_FILE;
    } else {
        console.error(`❌ Session auth.json or cookies.txt not found. Please log in first.`);
        return;
    }

    if (!fs.existsSync(USERS_FILE)) {
        console.error(`❌ Input file ${USERS_FILE} not found.`);
        return;
    }

    // Initialize CSV and clean existing data
    let completedHandles = new Set();
    const csvDir = path.dirname(X_CHECK_OUTPUT);
    if (!fs.existsSync(csvDir)) fs.mkdirSync(csvDir, { recursive: true });

    if (!fs.existsSync(X_CHECK_OUTPUT)) {
        fs.writeFileSync(X_CHECK_OUTPUT, 'Handle,Status,Post Count,Timestamp\n');
    } else {
        const existingCsv = fs.readFileSync(X_CHECK_OUTPUT, 'utf8').split('\n');
        const header = existingCsv[0];
        const rowMap = new Map();
        
        for (let i = 1; i < existingCsv.length; i++) {
            const line = existingCsv[i].trim();
            if (!line) continue;
            const handle = line.split(',')[0];
            rowMap.set(handle, line);
        }

        fs.writeFileSync(X_CHECK_OUTPUT, [header, ...Array.from(rowMap.values())].join('\n') + '\n');

        for (const line of rowMap.values()) {
            const handle = line.split(',')[0];
            const status = line.split(',')[1];
            if (status && !status.includes('Timeout/Network Error') && !status.includes('Error')) {
                completedHandles.add(handle);
            }
        }
    }

    const lines = fs.readFileSync(USERS_FILE, 'utf8').split('\n');
    let handles = [...new Set(lines.map(parseHandle).filter(h => h))];
    const initialCount = handles.length;
    handles = handles.filter(h => !completedHandles.has(h));

    console.log(`📦 Loaded ${initialCount} unique accounts from users.txt`);
    if (initialCount - handles.length > 0) {
        console.log(`⏭️  Resuming progress: Skipping ${initialCount - handles.length} already checked accounts.`);
    }
    
    if (handles.length === 0) {
        console.log(`\n🎉 All accounts are already processed!`);
        return;
    }

    let currentIndex = 0;
    const batchSize = 150;

    while (currentIndex < handles.length) {
        const batch = handles.slice(currentIndex, currentIndex + batchSize);
        console.log(`\n=== Starting Batch ${Math.floor(currentIndex / batchSize) + 1} (${batch.length} accounts) ===`);

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
            const timestamp = new Date().toISOString();
            fs.appendFileSync(X_CHECK_OUTPUT, `${handle},"${result.status}","${result.postCount}","${timestamp}"\n`);

            if (i < batch.length - 1) {
                const delay = X_CHECKER_PACING_MIN_MS + Math.floor(Math.random() * (X_CHECKER_PACING_MAX_MS - X_CHECKER_PACING_MIN_MS));
                await wait(delay);
            }
        }

        await browser.close();

        if (batchCanceled) {
            console.error('\n🛑 Scraper aborted early due to Rate Limit or Auth issues.');
            return;
        }

        currentIndex += batchSize;
        if (currentIndex < handles.length) {
            console.log(`\n💤 Batch complete. Waiting 15 minutes to reset X limit...`);
            await wait(X_CHECKER_BATCH_WAIT_MS);
        }
    }
    console.log(`\n🎉 All done! Results saved to ${X_CHECK_OUTPUT}`);
}

module.exports = {
    parseHandle,
    loadCookiesFromTxt,
    runXCheckerAuth,
    runXCheckerScan
};
