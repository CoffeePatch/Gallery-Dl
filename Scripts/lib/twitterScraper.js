const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { downloadWithRetry, getLosslessSnapshotUrl, getBulkDownloadUrl } = require('./download');
const { THREAD_NAV_LOAD_DELAY_MS, RateLimitError, API_MAX_RETRIES, API_BASE_RETRY_DELAY_MS } = require('./rateLimits');
const {
    ROOT_DIR,
    THREADS_OUTPUT_DIR,
    THREADS_RAW_DIR,
    THREADS_MEDIA_DIR,
    GRAPHQL_PAYLOAD_CONFIG
} = require('./paths');
const {
    performPacedScroll,
    forceLoadLazyImages,
    waitForImagesToLoad,
    upgradeImagesToHD,
    getSingleFileBundle
} = require('./browser');

const { downloadFile, handleMediaItem, processThreadMedia } = require('./mediaDownloader');
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

    console.log(`[API] Starting GraphQL fetch for thread ${tweetId}...`);

    let retryCount = 0;

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
                if (res.status === 429) {
                    const resetHeader = res.headers.get('x-rate-limit-reset');
                    let backoffMs = API_BASE_RETRY_DELAY_MS * Math.pow(3, retryCount);
                    if (resetHeader) {
                        const resetTimeMs = parseInt(resetHeader, 10) * 1000;
                        if (!isNaN(resetTimeMs) && resetTimeMs > Date.now()) {
                            backoffMs = Math.min(resetTimeMs - Date.now() + 1000, 60000);
                        }
                    }
                    console.warn(`[API Rate Limit] HTTP 429 encountered for thread ${tweetId}. Retry ${retryCount + 1}/${API_MAX_RETRIES} in ${Math.round(backoffMs / 1000)}s...`);
                    retryCount++;
                    if (retryCount > API_MAX_RETRIES) {
                        throw new RateLimitError(`API rate limit (HTTP 429) exceeded for thread ${tweetId}`, resetHeader);
                    }
                    await wait(backoffMs);
                    continue;
                }
                console.error(`[API Error] HTTP status: ${res.status}`);
                break;
            }

            // Reset rate limit retry count on successful response
            retryCount = 0;
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
            if (e instanceof RateLimitError) throw e;
            console.error(`[API Catch] Request failed: ${e.message}`);
            break;
        }
    }

    if (allRawEntries.length > 0) {
        const hasReplies = allRawEntries.some(e => e.entryId.startsWith("conversationthread-"));
        if (!hasReplies) {
            console.warn(`[API Warning] API fetched 0 replies. Might be a soft rate limit.`);
            return null;
        }
        const outFile = path.join(THREADS_RAW_DIR, `${tweetId}_thread.json`);
        fs.writeFileSync(outFile, JSON.stringify(allRawEntries, null, 2), 'utf-8');
        return outFile;
    }
    return null;
}

async function executeStrategyTwitterBrowser(browser, tweetId, url) {
    let page;
    try {
        console.log(`[Browser] Running native X scrape fallback for ${tweetId}...`);
        const outputPath = path.join(THREADS_OUTPUT_DIR, `${tweetId}.html`);

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
        await wait(THREAD_NAV_LOAD_DELAY_MS);

        console.log("[Browser] Scrolling thread timeline...");
        await performPacedScroll(page);
        await upgradeImagesToHD(page);
        await waitForImagesToLoad(page);

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
        return outputPath;
    } catch (e) {
        console.error(`[Browser Error] Native X scrape failed: ${e.message}`);
        if (page) {
            try { await page.close(); } catch(err) {}
        }
        return null;
    }
}

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
        return outputPath;
    } catch (e) {
        console.error(`[ThreadReader Error] Scrape failed for ${url}: ${e.message}`);
        if (page) {
            try { await page.close(); } catch(err) {}
        }
        return null;
    }
}

async function expandUserProfile(browser, userUrl, createQueueItem, dedupeQueueItems) {
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
        const uniqueItems = dedupeQueueItems(threadUrls.map(url => createQueueItem(url, userUrl)));
        
        console.log(`[Profile Router] Discovered ${uniqueItems.length} unique threads for user profile.`);
        await page.close();
        return uniqueItems;
    } catch (e) {
        console.error(`[Profile Router Error] Failed to expand profile ${userUrl}: ${e.message}`);
        if (page) {
            try { await page.close(); } catch(err) {}
        }
        return [];
    }
}

module.exports = {
    downloadFile,
    handleMediaItem,
    processThreadMedia,
    generateOfflineHtmlTimeline,
    executeStrategyAPI,
    executeStrategyTwitterBrowser,
    executeStrategyThreadReader,
    expandUserProfile
};
