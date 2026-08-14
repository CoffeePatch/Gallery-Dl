const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const esbuild = require('esbuild');
const { spawn, execSync } = require('child_process');
const { downloadWithRetry, getLosslessSnapshotUrl, getBulkDownloadUrl } = require('../lib/download');
const {
    THREAD_NAV_LOAD_DELAY_MS,
    THREAD_PACING_MIN_MS,
    THREAD_PACING_MAX_MS
} = require('../lib/rateLimits');
const { parseCookies, loadNetscapeCookiesForPuppeteer, getApiCredentials } = require('../lib/api');
const {
    performPacedScroll,
    forceLoadLazyImages,
    waitForImagesToLoad,
    upgradeImagesToHD,
    getSingleFileBundle
} = require('../lib/browser');
const {
    downloadFile,
    handleMediaItem,
    processThreadMedia,
    generateOfflineHtmlTimeline,
    executeStrategyAPI,
    executeStrategyTwitterBrowser,
    executeStrategyThreadReader,
    expandUserProfile: expandUserProfileLib
} = require('../lib/twitterScraper');

puppeteer.use(StealthPlugin());

// --- Paths Config ---
const {
    ROOT_DIR,
    THREADS_OUTPUT_DIR,
    THREADS_RAW_DIR,
    THREADS_MEDIA_DIR,
    COMPLETED_THREADS: COMPLETED_THREADS_TXT,
    FAILED_THREADS: FAILED_THREADS_TXT,
    URLS_THREADREADER,
    URLS_TWITTERTHREAD,
    COOKIES_FILE: COOKIES_PATH,
    GRAPHQL_PAYLOAD_CONFIG
} = require('../lib/paths');

// Ensure required directories exist
[THREADS_OUTPUT_DIR, THREADS_RAW_DIR, THREADS_MEDIA_DIR, path.dirname(COMPLETED_THREADS_TXT)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Helper wait function
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function readLines(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
}

function appendLine(filePath, line) {
    fs.appendFileSync(filePath, line + '\n', 'utf8');
}

function extractTweetId(url) {
    const match = url.match(/\/(\d+)(?:\.html)?$/);
    if (match) return match[1];
    if (/^\d+$/.test(url)) return url;
    return url.split('?')[0].replace(/\/+$/, '');
}

async function expandUserProfile(browser, userUrl, completedSet) {
    const createItem = (url) => ({ url, threadId: extractTweetId(url), sourceType: 'threadreader' });
    const dedupeItems = (items) => items.filter(item => !completedSet.has(item.url));
    const items = await expandUserProfileLib(browser, userUrl, createItem, dedupeItems);
    return items.map(item => item.url);
}

// ============================================================
// MAIN PIPELINE CONTROLLER
// ============================================================
async function main() {
    console.log("=========================================");
    console.log(" Starting Consolidated Thread Scraper");
    console.log("=========================================");

    // Read cookie authentication setup
    if (!fs.existsSync(COOKIES_PATH)) {
        console.error(`Error: Cookies file missing at ${COOKIES_PATH}`);
        process.exit(1);
    }
    const cookieText = fs.readFileSync(COOKIES_PATH, 'utf-8');
    const cookieObj = parseCookies(cookieText);
    const ct0 = cookieObj['ct0'];
    if (!ct0) {
        console.error("Error: CSRF Token 'ct0' not found in cookies.txt");
        process.exit(1);
    }
    const cookieString = Object.entries(cookieObj).map(([k, v]) => `${k}=${v}`).join('; ');
    const { queryId, bearerToken } = await getApiCredentials(cookieString);

    // Read Queue Inputs
    let rawUrls = [];
    const cliArg = process.argv[2];
    const unifiedQueuePath = path.join(ROOT_DIR, 'Config', 'Users', 'threads.txt');
    
    if (cliArg) {
        console.log(`[Input] Received direct URL argument: ${cliArg}`);
        rawUrls = [cliArg];
    } else {
        const threadreaderUrls = await readLines(URLS_THREADREADER);
        const twitterthreadUrls = await readLines(URLS_TWITTERTHREAD);
        const unifiedUrls = await readLines(unifiedQueuePath);
        rawUrls = [...threadreaderUrls, ...twitterthreadUrls, ...unifiedUrls];
    }

    if (rawUrls.length === 0) {
        console.log("No thread URLs found in queue files or CLI arguments.");
        process.exit(0);
    }

    // Filter completed
    const completed = await readLines(COMPLETED_THREADS_TXT);
    const completedSet = new Set(completed.map(u => extractTweetId(u)));

    if (!cliArg) {
        rawUrls = rawUrls.filter(u => !completedSet.has(extractTweetId(u)));
        console.log(`Loaded ${rawUrls.length} remaining URLs from queues.`);
    }

    // Spin up headless browser
    const browser = await puppeteer.launch({ headless: 'new' });
    
    // Inject cookies into Puppeteer context for Twitter sessions
    const pupCookies = loadNetscapeCookiesForPuppeteer(COOKIES_PATH);
    if (pupCookies.length > 0) {
        const dummyPage = await browser.newPage();
        await dummyPage.setCookie(...pupCookies);
        await dummyPage.close();
    }

    // Step 1: Expand profiles
    let queue = [];
    for (const url of rawUrls) {
        if (url.includes('threadreaderapp.com/user/')) {
            const discovered = await expandUserProfile(browser, url, completedSet);
            queue.push(...discovered);
        } else {
            queue.push(url);
        }
    }

    // Deduplicate queue
    queue = [...new Set(queue)];
    console.log(`\nFinal processing queue: ${queue.length} threads.`);

    if (queue.length === 0) {
        console.log("All tasks completed!");
        await browser.close();
        process.exit(0);
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < queue.length; i++) {
        const url = queue[i];
        const threadId = extractTweetId(url);
        console.log(`\n[${i + 1}/${queue.length}] Processing thread: ${url}`);

        let success = false;

        if (url.includes('threadreaderapp.com')) {
            // Strategy C: Scrape ThreadReader
            success = await executeStrategyThreadReader(browser, threadId, url);
        } else {
            // Twitter Thread
            // Try Strategy A (API)
            const rawJsonPath = await executeStrategyAPI(threadId, cookieString, ct0, queryId, bearerToken);
            if (rawJsonPath) {
                console.log(`[API Success] JSON fetched successfully.`);
                // Trigger media download
                // await processThreadMedia(rawJsonPath);
                // Trigger HTML builder
                generateOfflineHtmlTimeline(rawJsonPath);
                success = true;
            } else {
                console.log(`[API Failed/Rate-Limited] Falling back to browser scrape...`);
                // Fallback to Strategy B (Browser Scrape)
                success = await executeStrategyTwitterBrowser(browser, threadId, url);
            }
        }

        if (success) {
            successCount++;
            appendLine(COMPLETED_THREADS_TXT, url);
            
            // Clean queues from source files
            [URLS_THREADREADER, URLS_TWITTERTHREAD, unifiedQueuePath].forEach(qFile => {
                if (fs.existsSync(qFile)) {
                    let lines = fs.readFileSync(qFile, 'utf8').split('\n');
                    lines = lines.filter(l => l.trim() !== url.trim());
                    fs.writeFileSync(qFile, lines.join('\n'));
                }
            });
        } else {
            failCount++;
            appendLine(FAILED_THREADS_TXT, `${new Date().toISOString()} - ${url}`);
        }

        // Random delay 4-8s between threads
        if (i < queue.length - 1) {
            const delay = THREAD_PACING_MIN_MS + Math.floor(Math.random() * (THREAD_PACING_MAX_MS - THREAD_PACING_MIN_MS));
            console.log(`Delaying ${delay}ms before next thread...`);
            await wait(delay);
        }
    }

    await browser.close();
    console.log("\n=========================================");
    console.log(` Archiving Finished! (Saved: ${successCount}, Failed: ${failCount})`);
    console.log("=========================================");
}

main().catch(console.error);
