const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const esbuild = require('esbuild');
const { spawn, execSync } = require('child_process');
const { downloadWithRetry, getLosslessSnapshotUrl, getBulkDownloadUrl } = require('./lib/download');
const {
    THREAD_NAV_LOAD_DELAY_MS,
    THREAD_PACING_MIN_MS,
    THREAD_PACING_MAX_MS
} = require('./lib/rateLimits');

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
} = require('./lib/paths');

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

// ============================================================
// COOKIES & API UTILS (From fetch_thread.js)
// ============================================================
function parseCookies(cookieText) {
    const cookies = {};
    const lines = cookieText.split('\n');
    for (const line of lines) {
        if (line.trim() === '' || line.startsWith('#')) continue;
        const parts = line.split('\t');
        if (parts.length >= 7) {
            const name = parts[5];
            const value = parts[6].trim();
            cookies[name] = value;
        }
    }
    return cookies;
}

// Load Netscape cookies and map them for Puppeteer setCookie domain support
function loadNetscapeCookiesForPuppeteer(cookiesPath) {
    if (!fs.existsSync(cookiesPath)) return [];
    const content = fs.readFileSync(cookiesPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const cookies = [];

    for (let line of lines) {
        line = line.trim();
        if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;

        let isHttpOnly = false;
        if (line.startsWith('#HttpOnly_')) {
            isHttpOnly = true;
            line = line.substring(10);
        }

        const parts = line.split('\t');
        if (parts.length >= 7) {
            const domain = parts[0];
            const pathVal = parts[2];
            const secure = parts[3].toUpperCase() === 'TRUE';
            let expires = parseInt(parts[4]);
            if (isNaN(expires) || expires <= 0) expires = undefined;
            const name = parts[5];
            const value = parts[6].trim();

            cookies.push({
                name: name,
                value: value,
                domain: domain,
                path: pathVal,
                secure: secure,
                httpOnly: isHttpOnly,
                expires: expires
            });

            // Duplicate for x.com/twitter.com domain parity
            if (domain.includes('twitter.com')) {
                cookies.push({ name, value, domain: domain.replace('twitter.com', 'x.com'), path: pathVal, secure, httpOnly: isHttpOnly, expires });
            } else if (domain.includes('x.com')) {
                cookies.push({ name, value, domain: domain.replace('x.com', 'twitter.com'), path: pathVal, secure, httpOnly: isHttpOnly, expires });
            }
        }
    }
    return cookies;
}

async function getApiCredentials(cookieString) {
    const fallbackQueryId = "jd3V43oDY9cY7obs1YMfbQ";
    let queryId = fallbackQueryId;
    let bearerToken = null;

    try {
        const res = await fetch("https://x.com/", {
            headers: { 
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                "cookie": cookieString
            },
            signal: AbortSignal.timeout(20000)
        });
        const html = await res.text();
        const mainJsMatch = html.match(/src="(https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-z0-9]+\.js)"/);
        if (mainJsMatch) {
            const jsRes = await fetch(mainJsMatch[1], {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36" },
                signal: AbortSignal.timeout(20000)
            });
            const jsText = await jsRes.text();
            
            const qMatch = jsText.match(/queryId:"([^"]+)",operationName:"TweetDetail"/);
            if (qMatch) queryId = qMatch[1];
            
            const bearerMatch = jsText.match(/Bearer (AAAAAAAAAAAAAAAAAAAAA[^"']+)/);
            if (bearerMatch) bearerToken = bearerMatch[1];
        }
    } catch (e) {
        console.warn("[API] Failed to dynamically fetch API credentials, using fallback query ID:", e.message);
    }
    return { queryId, bearerToken };
}

// ============================================================
// PUPPETEER SCROLLER & SINGLEFILE CORE
// ============================================================
async function performPacedScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let lastScrollTop = -1;
            let lastScrollHeight = -1;
            let sameCount = 0;
            const distance = 400;
            const interval = 200;
            const maxSameCount = 10;

            const timer = setInterval(() => {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const scrollHeight = document.documentElement.scrollHeight;
                const clientHeight = document.documentElement.clientHeight;

                window.scrollBy(0, distance);

                if (scrollTop === lastScrollTop && scrollHeight === lastScrollHeight) {
                    sameCount++;
                } else {
                    sameCount = 0;
                }

                lastScrollTop = scrollTop;
                lastScrollHeight = scrollHeight;

                const isAtBottom = (scrollTop + clientHeight >= scrollHeight - 50);

                if (isAtBottom) {
                    if (sameCount >= maxSameCount) {
                        clearInterval(timer);
                        resolve();
                    }
                } else {
                    if (sameCount >= maxSameCount * 3) {
                        clearInterval(timer);
                        resolve();
                    }
                }
            }, interval);
        });
    });
}

async function forceLoadLazyImages(page) {
    await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img'));
        for (const img of images) {
            const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('lazy-src');
            if (dataSrc) {
                const currentSrc = img.getAttribute('src');
                if (currentSrc !== dataSrc) {
                    img.setAttribute('src', dataSrc);
                }
            }
            const dataSrcset = img.getAttribute('data-srcset');
            if (dataSrcset) {
                const currentSrcset = img.getAttribute('srcset');
                if (currentSrcset !== dataSrcset) {
                    img.setAttribute('srcset', dataSrcset);
                }
            }
        }
    });
}

async function waitForImagesToLoad(page) {
    await page.evaluate(async () => {
        const imgs = Array.from(document.querySelectorAll('img'));
        const promises = imgs.map(img => {
            if (img.complete && img.naturalWidth > 0) return Promise.resolve();
            return new Promise((resolve) => {
                img.addEventListener('load', () => resolve());
                img.addEventListener('error', () => resolve());
                setTimeout(resolve, 15000);
            });
        });
        await Promise.all(promises);
    });
}

// Upgrade X images to uncompressed formats
async function upgradeImagesToHD(page) {
    const fnStr = getLosslessSnapshotUrl.toString();
    await page.evaluate((fnStr) => {
        const rewriteUrl = new Function(`return (${fnStr})`)();
        const sources = Array.from(document.querySelectorAll('picture source'));
        for (const source of sources) source.remove();

        const images = Array.from(document.querySelectorAll('img'));

        for (const img of images) {
            const src = img.getAttribute('src');
            const dataSrc = img.getAttribute('data-src');

            if (src) img.setAttribute('src', rewriteUrl(src));
            if (dataSrc) img.setAttribute('data-src', rewriteUrl(dataSrc));
            if (img.getAttribute('srcset')) img.removeAttribute('srcset');
        }
    }, fnStr);
}

let singleFileBundle = null;
async function getSingleFileBundle() {
    if (singleFileBundle) return singleFileBundle;
    const result = await esbuild.build({
        entryPoints: [require.resolve('single-file-core/single-file.js')],
        bundle: true,
        write: false,
        format: 'iife',
        globalName: 'singlefile'
    });
    singleFileBundle = result.outputFiles[0].text;
    return singleFileBundle;
}

// ============================================================
// MEDIA DOWNLOAD PIPELINE (From download_thread_media.js)
// ============================================================
async function downloadFile(urlStr, dest) {
    if (fs.existsSync(dest)) return true; 
    return downloadWithRetry(urlStr, dest);
}

async function handleMediaItem(m, threadMediaDir) {
    if (m.type === 'photo') {
        const url = getBulkDownloadUrl(m.media_url_https);
        const filename = path.basename(new URL(url).pathname);
        await downloadFile(url, path.join(threadMediaDir, filename));
    } else if (m.type === 'video' || m.type === 'animated_gif') {
        const mp4s = (m.video_info?.variants || []).filter(v => v.content_type === "video/mp4");
        if (mp4s.length > 0) {
            const bestMp4 = mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            const filename = path.basename(new URL(bestMp4.url).pathname);
            await downloadFile(bestMp4.url, path.join(threadMediaDir, filename));
        }
    }
}

async function processThreadMedia(jsonFile) {
    const threadId = path.basename(jsonFile, '_thread.json');
    const threadMediaDir = path.join(THREADS_MEDIA_DIR, threadId);
    if (!fs.existsSync(threadMediaDir)) {
        fs.mkdirSync(threadMediaDir, { recursive: true });
    }

    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
    console.log(`[Media] Downloading media items for thread ${threadId}...`);

    for (const entry of data) {
        let result = null;
        if (entry.entryId.startsWith('tweet-')) {
            result = entry.content?.itemContent?.tweet_results?.result;
        } else if (entry.entryId.startsWith('conversationthread-')) {
            const items = entry.content?.items || [];
            for (const item of items) {
                const res = item.item?.itemContent?.tweet_results?.result;
                if (res) {
                    const media = res.legacy?.extended_entities?.media || [];
                    for (const m of media) await handleMediaItem(m, threadMediaDir);
                    const avatar = res.core?.user_results?.result?.legacy?.profile_image_url_https;
                    if (avatar) {
                        const avatarName = `avatar_${res.core.user_results.result.rest_id}.jpg`;
                        await downloadFile(avatar, path.join(threadMediaDir, avatarName));
                    }
                }
            }
        }
        if (result) {
            const media = result.legacy?.extended_entities?.media || [];
            for (const m of media) await handleMediaItem(m, threadMediaDir);
            const avatar = result.core?.user_results?.result?.legacy?.profile_image_url_https;
            if (avatar) {
                const avatarName = `avatar_${result.core.user_results.result.rest_id}.jpg`;
                await downloadFile(avatar, path.join(threadMediaDir, avatarName));
            }
        }
    }
}

// Trigger generate_html.js as a child process
function generateOfflineHtmlTimeline(jsonFilePath) {
    const htmlScript = path.join(ROOT_DIR, 'Scripts', 'generate_html.js');
    if (!fs.existsSync(htmlScript)) {
        console.warn("[Timeline Warning] generate_html.js not found, skipping HTML generation.");
        return;
    }
    try {
        console.log(`[Timeline] Generating self-contained HTML for thread ${path.basename(jsonFilePath)}...`);
        execSync(`node "${htmlScript}" "${jsonFilePath}"`, { stdio: 'ignore' });
        console.log(`[Timeline] Saved self-contained reader to Threads folder.`);
    } catch (e) {
        console.error(`[Timeline Error] Failed to generate HTML timeline: ${e.message}`);
    }
}

// ============================================================
// STRATEGY A: TWITTER API FETCH
// ============================================================
async function executeStrategyAPI(tweetId, cookieString, ct0, queryId, bearerToken) {
    if (!bearerToken) {
        console.warn(`[API Warning] Missing bearer token. Cannot use API strategy.`);
        return null;
    }
    let payload;
    try {
        payload = JSON.parse(fs.readFileSync(GRAPHQL_PAYLOAD_CONFIG, 'utf8'));
    } catch (e) {
        console.error(`[API Error] Failed to read or parse GraphQL payload configuration: ${e.message}`);
        return null;
    }

    const headers = {
        "authorization": `Bearer ${bearerToken}`,
        "x-csrf-token": ct0,
        "cookie": cookieString,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    };

    const variables = {
        ...payload.variables,
        "focalTweetId": tweetId
    };

    const features = payload.features;
    const fieldToggles = payload.fieldToggles;

    const allRawEntries = [];
    let cursor = null;
    let failCount = 0;

    console.log(`[API] Starting GraphQL fetch for thread ${tweetId}...`);

    while (true) {
        if (cursor) variables.cursor = cursor;

        const params = new URLSearchParams({
            variables: JSON.stringify(variables),
            features: JSON.stringify(features),
            fieldToggles: JSON.stringify(fieldToggles)
        });

        const url = `https://x.com/i/api/graphql/${queryId}/TweetDetail?${params.toString()}`;

        try {
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
            if (!res.ok) {
                console.error(`[API Error] HTTP status: ${res.status}`);
                break;
            }

            const data = await res.json();
            const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions || [];
            
            let entries = [];
            for (const instr of instructions) {
                if (instr.type === "TimelineAddEntries") {
                    entries = instr.entries || [];
                    break;
                }
            }

            if (entries.length === 0) break;

            const hasTweets = entries.some(e => e.entryId.startsWith("tweet-") || e.entryId.startsWith("conversationthread-"));
            if (!hasTweets && cursor !== null) break;

            allRawEntries.push(...entries);

            let newCursor = null;
            for (const entry of entries) {
                if (entry.entryId.startsWith("cursor-bottom-")) {
                    const content = entry.content;
                    if (content?.entryType === "TimelineTimelineItem") {
                        newCursor = content?.itemContent?.value;
                    } else if (content?.entryType === "TimelineTimelineCursor") {
                        newCursor = content?.value;
                    }
                }
            }

            if (newCursor && newCursor !== cursor) {
                cursor = newCursor;
                await wait(2000);
            } else {
                break;
            }
        } catch (e) {
            console.error(`[API Catch] Request failed: ${e.message}`);
            break;
        }
    }

    if (allRawEntries.length > 0) {
        const hasReplies = allRawEntries.some(e => e.entryId.startsWith("conversationthread-"));
        if (!hasReplies) {
            console.warn(`[API Warning] API fetched 0 replies. Might be a soft rate limit.`);
            return null; // Signals fallback to browser scrape
        }
        const outFile = path.join(THREADS_RAW_DIR, `${tweetId}_thread.json`);
        fs.writeFileSync(outFile, JSON.stringify(allRawEntries, null, 2), 'utf-8');
        return outFile;
    }
    return null;
}

// ============================================================
// STRATEGY B: NATIVE TWITTER BROWSER SCRAPE (Fallback)
// ============================================================
async function executeStrategyTwitterBrowser(browser, tweetId, url) {
    let page;
    try {
        console.log(`[Browser] Running native X scrape fallback for ${tweetId}...`);
        const outputPath = path.join(THREADS_OUTPUT_DIR, `${tweetId}.html`);

        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        // Request interception to handle CDN blocks
        await page.setRequestInterception(true);
        page.on('request', request => {
            const reqUrl = request.url();
            const headers = Object.assign({}, request.headers());
            if (reqUrl.includes('twimg.com')) {
                delete headers['origin'];
                delete headers['referer'];
                request.continue({ headers });
            } else {
                request.continue();
            }
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Wait for page load / authentication confirmation
        await wait(THREAD_NAV_LOAD_DELAY_MS);

        // Scroll
        console.log("[Browser] Scrolling thread timeline...");
        await performPacedScroll(page);
        await upgradeImagesToHD(page);
        await waitForImagesToLoad(page);

        // Compile SingleFile
        console.log("[Browser] Saving SingleFile bundle...");
        const scriptContent = await getSingleFileBundle();
        await page.addScriptTag({ content: scriptContent });

        const htmlData = await page.evaluate(async () => {
            const pageData = await window.singlefile.getPageData({});
            return pageData.content;
        });

        fs.writeFileSync(outputPath, htmlData, 'utf8');
        console.log(`[Browser Success] Saved thread HTML reader: ${outputPath}`);
        await page.close();
        return true;
    } catch (e) {
        console.error(`[Browser Error] Native X scrape failed: ${e.message}`);
        if (page) {
            try { await page.close(); } catch(err) {}
        }
        return false;
    }
}

// ============================================================
// STRATEGY C: THREADREADER SCRAPER (Puppeteer SingleFile)
// ============================================================
async function executeStrategyThreadReader(browser, threadId, url) {
    let page;
    try {
        console.log(`[ThreadReader] Scrape running for ${threadId}...`);
        const outputPath = path.join(THREADS_OUTPUT_DIR, `${threadId}.html`);

        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        await page.setRequestInterception(true);
        page.on('request', request => {
            const reqUrl = request.url();
            const headers = Object.assign({}, request.headers());
            if (reqUrl.includes('twimg.com')) {
                delete headers['origin'];
                delete headers['referer'];
                request.continue({ headers });
            } else {
                request.continue();
            }
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const initialContent = await page.content();
        if (initialContent.includes('cloudflare-challenge') || initialContent.includes('Just a moment...')) {
            throw new Error('Cloudflare challenge detected');
        }

        await performPacedScroll(page);
        await forceLoadLazyImages(page);
        await waitForImagesToLoad(page);

        // Wait network settle
        try {
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 });
        } catch (e) {}

        const scriptContent = await getSingleFileBundle();
        await page.addScriptTag({ content: scriptContent });

        const htmlData = await page.evaluate(async () => {
            const pageData = await window.singlefile.getPageData({});
            return pageData.content;
        });

        fs.writeFileSync(outputPath, htmlData, 'utf8');
        console.log(`[ThreadReader Success] Saved HTML reader: ${outputPath}`);
        await page.close();
        return true;
    } catch (e) {
        console.error(`[ThreadReader Error] Scrape failed for ${url}: ${e.message}`);
        if (page) {
            try { await page.close(); } catch(err) {}
        }
        return false;
    }
}

// ============================================================
// EXPAND USER PROFILE MODE (From threadreader_archiver.js)
// ============================================================
async function expandUserProfile(browser, userUrl, completedSet) {
    let page;
    try {
        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        console.log(`[Profile Router] Expanding user profile: ${userUrl}`);
        await page.goto(userUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        const initialContent = await page.content();
        if (initialContent.includes('cloudflare-challenge') || initialContent.includes('Just a moment...')) {
            throw new Error('Cloudflare challenge detected');
        }

        console.log(`[Profile Router] Loading all threads...`);
        await performPacedScroll(page);
        
        const threadHrefs = await page.evaluate(() => {
            const divs = Array.from(document.querySelectorAll('div[data-link-href^="/thread/"]'));
            return divs.map(div => div.getAttribute('data-link-href'));
        });

        const threadUrls = threadHrefs.map(href => `https://threadreaderapp.com${href}`);
        const uniqueUrls = [...new Set(threadUrls)].filter(u => !completedSet.has(u));

        console.log(`[Profile Router Success] Found ${uniqueUrls.length} new threads from profile.`);
        await page.close();
        return uniqueUrls;
    } catch (e) {
        console.error(`[Profile Router Error] Failed to expand profile ${userUrl}: ${e.message}`);
        if (page) {
            try { await page.close(); } catch(err) {}
        }
        return [];
    }
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
                await processThreadMedia(rawJsonPath);
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
