const fs = require('fs');
const path = require('path');
const readline = require('readline');

// --- Paths Config ---
const ROOT_DIR = path.resolve(__dirname, '..');
const RAW_DATA_DIR = path.join(ROOT_DIR, 'TweetData', 'RawData');
const LARGE_VIDEO_DIR = path.join(ROOT_DIR, 'TweetData', 'LargeRawData');
const RAW_THREADS_DIR = path.join(ROOT_DIR, 'TweetData', 'RawThreads');
const STATS_OUTPUT_PATH = path.join(ROOT_DIR, 'TweetData', 'summary_stats');

// Playwright Config
const AUTH_FILE = path.join(ROOT_DIR, 'Config', 'Settings', 'auth.json');
const COOKIES_FILE = path.join(ROOT_DIR, 'Config', 'Cookies', 'cookies.txt');
const X_CHECK_INPUT = path.join(ROOT_DIR, 'Config', 'Users', 'users.txt');
const X_CHECK_OUTPUT = path.join(ROOT_DIR, 'TweetData', 'AccountStatus', 'results.csv');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// 1. SUMMARY STATISTICS GENERATOR
// ============================================================
async function runStats(options = { format: 'both' }) {
    console.log('\n==================================================');
    console.log('       X/Twitter Summary Statistics Generator');
    console.log(` Raw Data Directory : ${RAW_DATA_DIR}`);
    console.log(` Output Format      : ${options.format}`);
    console.log(` Output Base Path   : ${STATS_OUTPUT_PATH}`);
    console.log('==================================================\n');

    if (!fs.existsSync(RAW_DATA_DIR)) {
        console.error(`Error: Source directory '${RAW_DATA_DIR}' does not exist.`);
        return;
    }

    const files = fs.readdirSync(RAW_DATA_DIR).filter(file => file.endsWith('.json'));
    if (files.length === 0) {
        console.log('No JSON files found in the source directory.');
        return;
    }

    console.log(`Analyzing ${files.length} files...`);

    const statsList = [];
    let grandTotalRecords = 0, grandTotalTweets = 0, grandTotalRetweets = 0, grandTotalVideos = 0, grandTotalImages = 0;

    for (const file of files) {
        const filePath = path.join(RAW_DATA_DIR, file);
        const accountName = file.replace(/_tweets\.json$|\.json$/i, '');

        let dataRaw;
        try {
            dataRaw = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
            console.error(`[Error] Failed to read ${file}: ${err.message}`);
            continue;
        }

        let records;
        try {
            records = JSON.parse(dataRaw);
        } catch (err) {
            console.error(`[Error] Failed to parse JSON in ${file}: ${err.message}`);
            continue;
        }

        if (!Array.isArray(records)) continue;

        let tweetsCount = 0, retweetsCount = 0, videosCount = 0, imagesCount = 0;

        for (const record of records) {
            const isLegacy = Array.isArray(record) && record[0] === 2;
            const isMedia = Array.isArray(record) && record[0] === 3;
            
            let dataObj = isLegacy ? record[1] : (isMedia ? record[2] : record);

            if (isLegacy || (!Array.isArray(record) && (record.tweet_id || record.id_str))) {
                tweetsCount++;
                if (dataObj.retweet_id && dataObj.retweet_id !== 0) {
                    retweetsCount++;
                }
            }

            if (isMedia || (!Array.isArray(record) && (record.type === 'photo' || record.type === 'video' || record.type === 'animated_gif'))) {
                const type = dataObj ? dataObj.type : null;
                if (type === 'video' || type === 'animated_gif') videosCount++;
                else if (type === 'photo') imagesCount++;
            }
        }

        const originalCount = tweetsCount - retweetsCount;
        statsList.push({
            account: accountName,
            totalRecords: records.length,
            totalTweets: tweetsCount,
            original: originalCount,
            retweets: retweetsCount,
            videos: videosCount,
            images: imagesCount
        });

        grandTotalRecords += records.length;
        grandTotalTweets += tweetsCount;
        grandTotalRetweets += retweetsCount;
        grandTotalVideos += videosCount;
        grandTotalImages += imagesCount;
    }

    statsList.sort((a, b) => b.totalRecords - a.totalRecords);

    // Save CSV
    if (options.format === 'csv' || options.format === 'both') {
        const csvPath = `${STATS_OUTPUT_PATH}.csv`;
        let csvContent = "Account,Total Records,Total Tweets,Original Tweets,Retweets,Videos,Images\n";
        statsList.forEach(s => {
            csvContent += `${s.account},${s.totalRecords},${s.totalTweets},${s.original},${s.retweets},${s.videos},${s.images}\n`;
        });
        csvContent += `GRAND TOTAL,${grandTotalRecords},${grandTotalTweets},${grandTotalTweets - grandTotalRetweets},${grandTotalRetweets},${grandTotalVideos},${grandTotalImages}\n`;
        fs.writeFileSync(csvPath, csvContent, 'utf8');
        console.log(`CSV report successfully saved to: ${csvPath}`);
    }

    // Save Markdown
    if (options.format === 'md' || options.format === 'both') {
        const mdPath = `${STATS_OUTPUT_PATH}.md`;
        let mdContent = `# X/Twitter Scraped Accounts Statistics\n\n`;
        mdContent += `*Report Generated: ${new Date().toLocaleString()}*\n\n`;
        mdContent += `## Grand Totals Summary\n\n`;
        mdContent += `| Metric | Count |\n| --- | --- |\n`;
        mdContent += `| **Total Records** | ${grandTotalRecords.toLocaleString()} |\n`;
        mdContent += `| **Total Tweets** | ${grandTotalTweets.toLocaleString()} |\n`;
        mdContent += `| **Original Tweets** | ${(grandTotalTweets - grandTotalRetweets).toLocaleString()} |\n`;
        mdContent += `| **Retweets** | ${grandTotalRetweets.toLocaleString()} |\n`;
        mdContent += `| **Videos** | ${grandTotalVideos.toLocaleString()} |\n`;
        mdContent += `| **Images** | ${grandTotalImages.toLocaleString()} |\n\n`;

        mdContent += `## Account Detailed Statistics\n\n`;
        mdContent += `| Account | Total Records | Total Tweets | Original Tweets | Retweets | Videos | Images |\n`;
        mdContent += `| --- | --- | --- | --- | --- | --- | --- |\n`;
        statsList.forEach(s => {
            mdContent += `| **${s.account}** | ${s.totalRecords.toLocaleString()} | ${s.totalTweets.toLocaleString()} | ${s.original.toLocaleString()} | ${s.retweets.toLocaleString()} | ${s.videos.toLocaleString()} | ${s.images.toLocaleString()} |\n`;
        });
        fs.writeFileSync(mdPath, mdContent, 'utf8');
        console.log(`Markdown report successfully saved to: ${mdPath}`);
    }

    console.log('\n==================================================');
    console.log('                Execution Summary');
    console.log(` Handles Processed : ${files.length}`);
    console.log(` Total Tweets      : ${grandTotalTweets} (${grandTotalRetweets} Retweets, ${grandTotalTweets - grandTotalRetweets} Original)`);
    console.log(` Total Videos      : ${grandTotalVideos}`);
    console.log(` Total Images      : ${grandTotalImages}`);
    console.log('==================================================');
}

// ============================================================
// 2. LARGE VIDEO FILTER (Videos >= 30m / 1800s by default)
// ============================================================
async function runFilterLargeVideos(thresholdSec = 1800) {
    console.log('\n==================================================');
    console.log('       X/Twitter Large Video Data Filter');
    console.log(` Duration Threshold : ${thresholdSec} seconds (${thresholdSec / 60} minutes)`);
    console.log(` Raw Data Directory : ${RAW_DATA_DIR}`);
    console.log(` Output Directory   : ${LARGE_VIDEO_DIR}`);
    console.log('==================================================\n');

    if (!fs.existsSync(RAW_DATA_DIR)) {
        console.error(`Error: Source directory '${RAW_DATA_DIR}' does not exist.`);
        return;
    }
    if (!fs.existsSync(LARGE_VIDEO_DIR)) fs.mkdirSync(LARGE_VIDEO_DIR, { recursive: true });

    const files = fs.readdirSync(RAW_DATA_DIR).filter(file => file.endsWith('.json'));
    if (files.length === 0) {
        console.log('No JSON files found in source directory.');
        return;
    }

    let totalProcessedFiles = 0, totalLargeVideosFound = 0;

    for (const file of files) {
        const filePath = path.join(RAW_DATA_DIR, file);
        const outputFilePath = path.join(LARGE_VIDEO_DIR, file.replace('_tweets.json', '_Large.json'));

        let dataRaw = fs.readFileSync(filePath, 'utf8');
        let records = JSON.parse(dataRaw);
        if (!Array.isArray(records)) continue;

        const filteredVideos = records.filter(record => {
            let isVideo = false, duration = null;

            if (Array.isArray(record)) {
                if (record[0] === 3 && record[2]) {
                    isVideo = record[2].type === 'video' || record[2].type === 'animated_gif';
                    duration = record[2].duration;
                }
            } else if (record.type === 'video' || record.type === 'animated_gif') {
                isVideo = true;
                duration = record.duration;
            }

            if (isVideo && duration !== null && duration !== undefined) {
                const durationSec = parseFloat(duration);
                return !isNaN(durationSec) && durationSec >= thresholdSec;
            }
            return false;
        });

        if (filteredVideos.length > 0) {
            fs.writeFileSync(outputFilePath, JSON.stringify(filteredVideos, null, 2), 'utf8');
            console.log(`[${file}] Extracted ${filteredVideos.length} large videos to LargeRawData.`);
            totalLargeVideosFound += filteredVideos.length;
            totalProcessedFiles++;
        }
    }

    console.log(`\nFiltered ${totalLargeVideosFound} large videos across ${totalProcessedFiles} files.`);
}

// ============================================================
// 3. THREAD SEPARATOR
// ============================================================
async function runSeparateThreads() {
    console.log('\n==================================================');
    console.log('          X/Twitter Thread Separator');
    console.log(` Raw Data Directory : ${RAW_DATA_DIR}`);
    console.log(` Output Directory   : ${RAW_THREADS_DIR}`);
    console.log('==================================================\n');

    if (!fs.existsSync(RAW_DATA_DIR)) {
        console.error(`Directory not found: ${RAW_DATA_DIR}`);
        return;
    }
    if (!fs.existsSync(RAW_THREADS_DIR)) fs.mkdirSync(RAW_THREADS_DIR, { recursive: true });

    const files = fs.readdirSync(RAW_DATA_DIR).filter(f => f.endsWith('.json'));
    console.log(`Found ${files.length} JSON files to process for threads...`);

    let totalThreadsMoved = 0, totalFilesModified = 0;

    for (const file of files) {
        const filePath = path.join(RAW_DATA_DIR, file);
        const threadFilePath = path.join(RAW_THREADS_DIR, file);

        let dataRaw = fs.readFileSync(filePath, 'utf8');
        let records = JSON.parse(dataRaw);
        if (!Array.isArray(records)) continue;

        const convoMap = new Map();
        for (const record of records) {
            const dataObj = Array.isArray(record) ? (record[0] === 2 ? record[1] : record[2]) : record;
            if (dataObj && dataObj.conversation_id && dataObj.tweet_id) {
                if (!convoMap.has(dataObj.conversation_id)) convoMap.set(dataObj.conversation_id, new Set());
                convoMap.get(dataObj.conversation_id).add(dataObj.tweet_id);
            }
        }

        const threadConvoIds = new Set();
        for (const [convoId, tweetIds] of convoMap.entries()) {
            if (tweetIds.size > 1) threadConvoIds.add(convoId);
        }

        if (threadConvoIds.size === 0) continue;

        const standaloneRecords = [], threadRecords = [];
        for (const record of records) {
            const dataObj = Array.isArray(record) ? (record[0] === 2 ? record[1] : record[2]) : record;
            if (dataObj && dataObj.conversation_id && threadConvoIds.has(dataObj.conversation_id)) {
                threadRecords.push(record);
            } else {
                standaloneRecords.push(record);
            }
        }

        if (threadRecords.length > 0) {
            totalThreadsMoved += threadConvoIds.size;
            totalFilesModified++;

            let existingThreadRecords = [];
            if (fs.existsSync(threadFilePath)) {
                try {
                    existingThreadRecords = JSON.parse(fs.readFileSync(threadFilePath, 'utf8'));
                } catch(e) {}
            }

            const combinedThreads = [...existingThreadRecords, ...threadRecords];
            fs.writeFileSync(threadFilePath, JSON.stringify(combinedThreads, null, 2));
            fs.writeFileSync(filePath, JSON.stringify(standaloneRecords, null, 2));

            console.log(`[${file}] Moved ${threadConvoIds.size} threads (${threadRecords.length} records) to RawThreads.`);
        }
    }

    console.log(`\nFinished! Separated ${totalThreadsMoved} threads across ${totalFilesModified} files.`);
}

// ============================================================
// 4. CLEAN SELF RETWEETS
// ============================================================
async function runCleanSelfRetweets() {
    console.log('\n==================================================');
    console.log('       X/Twitter Self-Retweets Cleaner');
    console.log(` Directory : ${RAW_DATA_DIR}`);
    console.log('==================================================\n');

    if (!fs.existsSync(RAW_DATA_DIR)) {
        console.error(`Directory not found: ${RAW_DATA_DIR}`);
        return;
    }

    const files = fs.readdirSync(RAW_DATA_DIR).filter(f => f.endsWith('.json'));
    console.log(`Found ${files.length} JSON files to process.`);

    let totalCleaned = 0;

    for (const file of files) {
        const filePath = path.join(RAW_DATA_DIR, file);
        const accountName = file.replace(/_tweets\.json$/i, '');

        let dataRaw = fs.readFileSync(filePath, 'utf8');
        let records = JSON.parse(dataRaw);
        if (!Array.isArray(records)) continue;

        const initialLength = records.length;

        const cleanedRecords = records.filter(record => {
            const isLegacy = Array.isArray(record) && record[0] === 2;
            if (isLegacy) {
                const tweetObj = record[1];
                if (tweetObj.retweet_id && tweetObj.retweet_id !== 0) {
                    const authorName = tweetObj.author ? tweetObj.author.name : null;
                    if (authorName && authorName.toLowerCase() === accountName.toLowerCase()) {
                        return false; // Filter out self-retweet
                    }
                }
            }
            return true;
        });

        const cleanedCount = initialLength - cleanedRecords.length;
        if (cleanedCount > 0) {
            fs.writeFileSync(filePath, JSON.stringify(cleanedRecords, null, 2), 'utf8');
            console.log(`[${file}] Cleaned ${cleanedCount} self-retweets.`);
            totalCleaned += cleanedCount;
        }
    }

    console.log(`\nFinished! Cleaned a total of ${totalCleaned} self-retweets.`);
}

// ============================================================
// 5. X.COM ACCOUNT STATUS CHECKER (Playwright)
// ============================================================
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
    const { chromium } = require('playwright');
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
        await page.waitForTimeout(2000); 

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
    console.log(` Input File  : ${X_CHECK_INPUT}`);
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

    if (!fs.existsSync(X_CHECK_INPUT)) {
        console.error(`❌ Input file ${X_CHECK_INPUT} not found.`);
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

    const lines = fs.readFileSync(X_CHECK_INPUT, 'utf8').split('\n');
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

    const { chromium } = require('playwright');
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
                const delay = 3000 + Math.floor(Math.random() * 3000);
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
            await wait(15 * 60 * 1000);
        }
    }
    console.log(`\n🎉 All done! Results saved to ${X_CHECK_OUTPUT}`);
}

// ============================================================
// MENU & CLI INTERFACE
// ============================================================
async function runInteractiveMenu() {
    showMenu();
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on('line', async (line) => {
        const choice = line.trim();
        rl.close();

        switch (choice) {
            case '1':
                await runStats();
                break;
            case '2':
                await runFilterLargeVideos();
                break;
            case '3':
                await runSeparateThreads();
                break;
            case '4':
                await runCleanSelfRetweets();
                break;
            case '5':
                await runXCheckerScan();
                break;
            case '6':
                console.log("Exiting... Goodbye!");
                process.exit(0);
            default:
                console.log("Invalid option. Please try again.");
                break;
        }
        
        // Loop back
        await wait(2000);
        runInteractiveMenu();
    });
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--stats')) {
        await runStats();
    } else if (args.includes('--filter-large')) {
        await runFilterLargeVideos();
    } else if (args.includes('--separate-threads')) {
        await runSeparateThreads();
    } else if (args.includes('--clean-retweets')) {
        await runCleanSelfRetweets();
    } else if (args.includes('--x-check')) {
        await runXCheckerScan();
    } else if (args.includes('--x-auth')) {
        await runXCheckerAuth();
    } else {
        runInteractiveMenu();
    }
}

main().catch(console.error);
