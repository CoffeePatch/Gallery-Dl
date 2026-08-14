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
    THREAD_PACING_MAX_MS,
    RateLimitError
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
    ARCHIVE_STATE_DB,
    COOKIES_FILE: COOKIES_PATH,
    GRAPHQL_PAYLOAD_CONFIG
} = require('../lib/paths');
const { ArchiveStateStore, inferArchiveSourceType } = require('../lib/archiveState');

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

function createQueueItem(url, profileUrl = null) {
    const threadId = extractTweetId(url);
    return {
        url,
        threadId,
        sourceType: inferArchiveSourceType(url),
        profileUrl
    };
}

function mergeQueueItem(existing, incoming) {
    if (!existing.profileUrl && incoming.profileUrl) {
        existing.profileUrl = incoming.profileUrl;
    }
    if (existing.sourceType === 'unknown' && incoming.sourceType !== 'unknown') {
        existing.sourceType = incoming.sourceType;
    }
    return existing;
}

function dedupeQueueItems(items) {
    const byThreadId = new Map();
    for (const item of items) {
        if (!item.threadId) continue;
        if (byThreadId.has(item.threadId)) {
            mergeQueueItem(byThreadId.get(item.threadId), item);
        } else {
            byThreadId.set(item.threadId, { ...item });
        }
    }
    return [...byThreadId.values()];
}

async function expandUserProfile(browser, userUrl) {
    return expandUserProfileLib(browser, userUrl, createQueueItem, dedupeQueueItems);
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
    const archiveState = new ArchiveStateStore(ARCHIVE_STATE_DB);
    archiveState.init();
    archiveState.seedLegacyCompletedThreads(COMPLETED_THREADS_TXT);
    archiveState.seedExistingArchiveFiles(THREADS_OUTPUT_DIR);

    // Read Queue Inputs
    let rawUrls = [];
    const cliArg = process.argv[2];
    const unifiedQueuePath = path.join(ROOT_DIR, 'Config', 'Users', 'threads.txt');
    
    if (cliArg) {
        console.log(`[Input] Received direct URL argument: ${cliArg}`);
        rawUrls = [cliArg];
    } else {
        rawUrls = await readLines(unifiedQueuePath);
    }

    if (rawUrls.length === 0) {
        console.log("No thread URLs found in queue files or CLI arguments.");
        process.exit(0);
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
            const discovered = await expandUserProfile(browser, url);
            queue.push(...discovered);
        } else {
            queue.push(createQueueItem(url));
        }
    }

    // Deduplicate and skip already archived thread IDs.
    queue = dedupeQueueItems(queue).filter(item => {
        if (archiveState.isArchived(item.threadId)) {
            console.log(`[State] Skipping archived thread ${item.threadId}`);
            return false;
        }
        return true;
    });

    console.log(`\nFinal processing queue: ${queue.length} threads.`);

    if (queue.length === 0) {
        console.log("All tasks completed!");
        await browser.close();
        process.exit(0);
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        const { url, threadId, sourceType, profileUrl } = item;
        console.log(`\n[${i + 1}/${queue.length}] Processing thread: ${url}`);

        let success = false;
        let outputPath = null;
        let errorMessage = null;

        if (url.includes('threadreaderapp.com')) {
            // Strategy C: Scrape ThreadReader
            outputPath = await executeStrategyThreadReader(browser, threadId, url);
            success = Boolean(outputPath);
            if (!success) {
                errorMessage = 'ThreadReader scrape failed';
            }
        } else {
            // Twitter Thread
            // Try Strategy A (API)
            try {
                const rawJsonPath = await executeStrategyAPI(threadId, cookieString, ct0, queryId, bearerToken);
                if (rawJsonPath) {
                    console.log(`[API Success] JSON fetched successfully.`);
                    // Trigger media download
                    await processThreadMedia(rawJsonPath);
                    // Trigger HTML builder
                    generateOfflineHtmlTimeline(rawJsonPath);
                    outputPath = path.join(THREADS_OUTPUT_DIR, `${threadId}.html`);
                    success = true;
                } else {
                    console.log(`[API Failed] Falling back to browser scrape...`);
                    // Fallback to Strategy B (Browser Scrape)
                    outputPath = await executeStrategyTwitterBrowser(browser, threadId, url);
                    success = Boolean(outputPath);
                    if (!success) {
                        errorMessage = 'API fetch and browser scrape failed';
                    }
                }
            } catch (err) {
                if (err instanceof RateLimitError) {
                    console.warn(`[Rate Limit Guard] Suppressing Puppeteer browser scrape for thread ${threadId} due to active API rate limit block.`);
                    errorMessage = `Rate limited: ${err.message}`;
                    success = false;
                } else {
                    throw err;
                }
            }
        }

        if (success) {
            successCount++;
            archiveState.recordSuccess({
                threadId,
                sourceUrl: url,
                sourceType,
                profileUrl,
                outputPath
            });
            appendLine(COMPLETED_THREADS_TXT, url);
            
            // Clean the unified input queue
            if (fs.existsSync(unifiedQueuePath)) {
                let lines = fs.readFileSync(unifiedQueuePath, 'utf8').split('\n');
                lines = lines.filter(l => l.trim() !== url.trim());
                fs.writeFileSync(unifiedQueuePath, lines.join('\n'));
            }
        } else {
            failCount++;
            archiveState.recordFailure({
                threadId,
                sourceUrl: url,
                sourceType,
                profileUrl,
                errorMessage: errorMessage || 'Thread archiving failed',
                outputPath
            });
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
