const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const esbuild = require('esbuild');

puppeteer.use(StealthPlugin());

const OUTPUT_DIR = path.join(__dirname, '..', 'TweetData', 'Threads');
const COMPLETED_FILE = path.join(__dirname, '..', 'Config', 'Queues', 'completed_threads.txt');
const FAILED_FILE = path.join(__dirname, '..', 'Config', 'Queues', 'failed_threads.txt');
const URLS_THREADREADER = path.join(__dirname, '..', 'Config', 'Users', 'urls_threadreader.txt');
const URLS_TWITTERTHREAD = path.join(__dirname, '..', 'Config', 'Users', 'urls_twitterthread.txt');

const COOKIES_FILE = path.join(__dirname, '..', 'Config', 'Cookies', 'cookies.txt');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Helper wait function
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function readLines(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

function appendLine(filePath, line) {
    fs.appendFileSync(filePath, line + '\n', 'utf8');
}

// Parses Netscape-format cookie files to JSON objects suitable for Puppeteer setCookie
function loadNetscapeCookies(cookiesPath) {
    if (!fs.existsSync(cookiesPath)) {
        throw new Error(`Cookies file not found at: ${cookiesPath}`);
    }
    console.log(`[Cookies] Loading cookies from: ${cookiesPath}`);
    const content = fs.readFileSync(cookiesPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const cookies = [];

    for (let line of lines) {
        line = line.trim();
        // Skip empty lines and comments, but process #HttpOnly_ comments
        if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) {
            continue;
        }

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
            if (isNaN(expires) || expires <= 0) {
                expires = undefined; // Treating it as a session cookie
            }
            const name = parts[5];
            const value = parts[6].trim();

            // Push original cookie
            cookies.push({
                name: name,
                value: value,
                domain: domain,
                path: pathVal,
                secure: secure,
                httpOnly: isHttpOnly,
                expires: expires
            });

            // Duplicate cookies for x.com/twitter.com to be robust against domain differences
            if (domain.includes('twitter.com')) {
                cookies.push({
                    name: name,
                    value: value,
                    domain: domain.replace('twitter.com', 'x.com'),
                    path: pathVal,
                    secure: secure,
                    httpOnly: isHttpOnly,
                    expires: expires
                });
            } else if (domain.includes('x.com')) {
                cookies.push({
                    name: name,
                    value: value,
                    domain: domain.replace('x.com', 'twitter.com'),
                    path: pathVal,
                    secure: secure,
                    httpOnly: isHttpOnly,
                    expires: expires
                });
            }
        }
    }

    console.log(`[Cookies] Successfully loaded and expanded to ${cookies.length} cookies.`);
    return cookies;
}

// Extracts thread ID (last numeric sequence) from a Thread Reader or Twitter URL
function extractThreadId(url) {
    // Matches threadreaderapp.com/thread/12345.html or x.com/user/status/12345
    const match = url.match(/\/(\d+)(?:\.html)?$/);
    return match ? match[1] : null;
}

// Dynamically changes image sources in the DOM to request original uncompressed PNGs
async function upgradeImagesToHD(page) {
    await page.evaluate(() => {
        // Remove source elements inside picture tags so they fall back to our upscaled img tags
        const sources = Array.from(document.querySelectorAll('picture source'));
        for (const source of sources) {
            source.remove();
        }

        const images = Array.from(document.querySelectorAll('img'));
        let count = 0;

        const rewriteUrl = (urlStr) => {
            if (!urlStr || !urlStr.includes('pbs.twimg.com/media/')) return urlStr;
            try {
                const url = new URL(urlStr);
                let changed = false;
                if (url.searchParams.has('name')) {
                    url.searchParams.delete('name');
                    changed = true;
                }
                if (url.searchParams.get('format') !== 'png') {
                    url.searchParams.set('format', 'png');
                    changed = true;
                }
                return changed ? url.toString() : urlStr;
            } catch (e) {
                return urlStr;
            }
        };

        for (const img of images) {
            const src = img.getAttribute('src');
            const dataSrc = img.getAttribute('data-src');

            if (src) {
                const newSrc = rewriteUrl(src);
                if (newSrc !== src) {
                    img.setAttribute('src', newSrc);
                    count++;
                }
            }
            if (dataSrc) {
                const newDataSrc = rewriteUrl(dataSrc);
                if (newDataSrc && newDataSrc !== dataSrc) {
                    img.setAttribute('data-src', newDataSrc);
                }
            }

            // Remove srcset to prevent loading lower resolution responsive images
            if (img.getAttribute('srcset')) {
                img.removeAttribute('srcset');
            }
        }

        // Also scan and replace background-image URLs in styled elements
        const styledElements = Array.from(document.querySelectorAll('[style*="pbs.twimg.com/media/"]'));
        for (const el of styledElements) {
            const style = el.getAttribute('style') || '';
            const bgMatch = style.match(/url\(["']?(https:\/\/pbs\.twimg\.com\/media\/[^)"']+)["']?\)/);
            if (bgMatch && bgMatch[1]) {
                const originalUrl = bgMatch[1];
                const newUrl = rewriteUrl(originalUrl);
                if (newUrl !== originalUrl) {
                    el.style.backgroundImage = `url("${newUrl}")`;
                }
            }
        }

        if (count > 0) {
            console.log(`[JS DOM] Upgraded ${count} image src links to HD format=png.`);
        }
    });
}

// Helper function for smooth scrolling simulating mouse scroll events
async function smoothScroll(page, targetPosition, duration = 800) {
    await page.evaluate(async (target, dur) => {
        const start = window.pageYOffset || document.documentElement.scrollTop;
        const difference = target - start;
        if (difference <= 0) return;

        const steps = 15;
        const stepDelay = dur / steps;

        for (let i = 1; i <= steps; i++) {
            const progress = i / steps;
            // EaseInOutQuad easing
            const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            window.scrollTo(0, start + difference * ease);
            await new Promise(resolve => setTimeout(resolve, stepDelay));
        }
    }, targetPosition, duration);
}

// Evaluates whether a login overlay/wall or "Something went wrong" warning is blocking the content
async function checkForLoginPrompt(page) {
    const promptDetected = await page.evaluate(() => {
        const textToSearch = ["Sign in to X", "Don't miss what's happening", "Log in to X", "Sign up to X", "Something went wrong"];
        const pageText = document.body.innerText || "";
        for (const text of textToSearch) {
            if (pageText.includes(text)) {
                const modal = document.querySelector('[data-testid="sheetDialog"]') || document.querySelector('[role="dialog"]');
                if (modal || text === "Something went wrong") {
                    return text;
                }
            }
        }
        return null;
    });
    if (promptDetected) {
        console.warn(`\n⚠️  [WARNING] Twitter/X warning or prompt detected: "${promptDetected}"`);
        console.warn(`⚠️  This indicates that your session cookies in cookies.txt may be invalid or expired.`);
        console.warn(`⚠️  Please log in on your browser, export fresh cookies, and update cookies.txt to continue.\n`);
    }
}

// Expands long tweets, line clamps on quotes, and clicks "Show replies" / "Show more replies" with pacing
async function expandThreadContent(page) {
    return await page.evaluate(async () => {
        const waitLocal = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        let clickCount = 0;

        // 1. Expand long tweets & remove line clamps on quoted tweets
        const showMoreButtons = Array.from(document.querySelectorAll("article button[data-testid='tweet-text-show-more-link']"));
        for (const showMoreBtn of showMoreButtons) {
            if (showMoreBtn.getAttribute('data-clicked') !== 'true') {
                const rect = showMoreBtn.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    showMoreBtn.setAttribute('data-clicked', 'true');
                    showMoreBtn.click();
                    clickCount++;
                    await waitLocal(500); // Gentle pacing delay
                }
            }
        }

        document.querySelectorAll("article").forEach((tweet) => {
            const quotedTweet = tweet.querySelector("div[id^='id__'][aria-labelledby^='id__']");
            if (quotedTweet) {
                const quotedText = quotedTweet.querySelector("div[data-testid='tweetText']");
                if (quotedText) {
                    quotedText.style.removeProperty("-webkit-line-clamp");
                    quotedText.style.maxHeight = 'none';
                }
            }
        });

        // 2. Click "Show more replies", "Show replies", "Show" (sensitive media), etc.
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const btn of buttons) {
            const text = (btn.innerText || '').trim().toLowerCase();
            const targetKeywords = [
                'show replies',
                'show more replies',
                'show',
                'view replies',
                'view more replies'
            ];

            if (targetKeywords.includes(text)) {
                if (btn.getAttribute('data-clicked') === 'true') {
                    continue;
                }
                const rect = btn.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    btn.setAttribute('data-clicked', 'true');
                    btn.click();
                    clickCount++;
                    await waitLocal(800); // Gentle pacing delay to load replies
                }
            }
        }

        return clickCount;
    });
}

// Wait for all loaded images in the DOM to complete downloading
async function waitForImagesToLoad(page) {
    console.log(`[Processing] Waiting for images to complete loading...`);
    await page.evaluate(async () => {
        const imgs = Array.from(document.querySelectorAll('img'));
        const promises = imgs.map(img => {
            if (img.complete && img.naturalWidth > 0) {
                return Promise.resolve();
            }
            return new Promise((resolve) => {
                img.addEventListener('load', () => resolve());
                img.addEventListener('error', () => resolve());
                setTimeout(resolve, 15000); // 15s max safeguard
            });
        });
        await Promise.all(promises);
    });
}

// Bundles single-file-core using esbuild so it can be injected
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

// Performs pacing scrolls and clicks expand buttons until the full thread has loaded.
async function scrollAndExpandThread(page) {
    console.log(`[Interaction] Scrolling and expanding thread replies smoothly...`);
    let lastHeight = await page.evaluate('document.documentElement.scrollHeight');
    let scrollPosition = 0;
    let sameHeightCount = 0;
    const maxSameHeightRetries = 15; // Stop when height doesn't change for 15 steps
    let scrollAttempts = 0;
    const maxScrollAttempts = 40; // Safety guard to prevent infinite loops

    // Inject CSS to keep scrollbars visible and active
    await page.evaluate(() => {
        if (!document.getElementById('force-scrollbar-style')) {
            const style = document.createElement('style');
            style.id = 'force-scrollbar-style';
            style.innerHTML = `
                html, body {
                    overflow: auto !important;
                    overflow-y: scroll !important;
                }
            `;
            document.head.appendChild(style);
        }
    });

    while (sameHeightCount < maxSameHeightRetries) {
        const scrollDistance = 500;
        await smoothScroll(page, scrollPosition + scrollDistance, 600);
        scrollPosition += scrollDistance;

        await wait(500); // Settle wait

        // Click expand replies and show-more buttons
        const clicks = await expandThreadContent(page);
        if (clicks > 0) {
            console.log(`[Interaction] Expanded ${clicks} items.`);
            await wait(1000); // Wait 1s for content load
        }

        await wait(1000); // Scrolling pacing

        await checkForLoginPrompt(page);

        const currentHeight = await page.evaluate('document.documentElement.scrollHeight');
        const articleCount = await page.evaluate(() => document.querySelectorAll('article').length);

        scrollAttempts++;
        if (scrollAttempts >= maxScrollAttempts) {
            console.log(`[Interaction] Safeguard: Reached maximum scroll attempts (${maxScrollAttempts}). Stopping.`);
            break;
        }

        if (articleCount < 2) {
            // Under minimum requirements (at least 2 tweets in a thread), keep scrolling and waiting
            sameHeightCount = 0;
        } else if (currentHeight === lastHeight && scrollPosition >= currentHeight) {
            sameHeightCount++;
        } else {
            sameHeightCount = 0;
            lastHeight = currentHeight;
        }
    }

    console.log(`[Interaction] Scrolling finished. Final height: ${lastHeight}px`);
}

async function processUrl(browser, page, url, cookies, retryCount = 0) {
    try {
        const threadId = extractThreadId(url);
        if (!threadId) {
            throw new Error(`Cannot extract thread ID from URL: ${url}`);
        }

        const outputPath = path.join(OUTPUT_DIR, `${threadId}.html`);
        if (fs.existsSync(outputPath)) {
            console.log(`[Skip] Already archived: ${url}`);
            return true;
        }

        const directTwitterUrl = url;
        console.log(`[Processing] Navigating to: ${directTwitterUrl}`);

        await page.setViewport({ width: 1920, height: 1080 });

        // Register style injection to prevent Twitter from hiding scrollbars during navigation
        await page.evaluateOnNewDocument(() => {
            const style = document.createElement('style');
            style.id = 'force-scrollbar-style';
            style.innerHTML = `
                html, body {
                    overflow: auto !important;
                    overflow-y: scroll !important;
                }
            `;
            document.head.appendChild(style);
        });

        // Apply cookies
        await page.setCookie(...cookies);

        // Bypass CSP so that we can inject single-file-core script successfully
        await page.setBypassCSP(true);

        await page.goto(directTwitterUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Double-check style injection
        await page.evaluate(() => {
            if (!document.getElementById('force-scrollbar-style')) {
                const style = document.createElement('style');
                style.id = 'force-scrollbar-style';
                style.innerHTML = `
                    html, body {
                        overflow: auto !important;
                        overflow-y: scroll !important;
                    }
                `;
                document.head.appendChild(style);
            }
        });

        console.log(`[Processing] Waiting for at least 2 tweets (articles) to load...`);
        try {
            await page.waitForFunction(() => {
                return document.querySelectorAll('article').length >= 2;
            }, { timeout: 45000 });
            console.log(`[Processing] Found at least 2 tweets successfully.`);
        } catch (err) {
            console.log(`[Warning] Did not find 2 tweets within 45s. Checking page status...`);
            await checkForLoginPrompt(page);
            const count = await page.evaluate(() => document.querySelectorAll('article').length);
            if (count === 0) {
                throw new Error(`No tweets (article elements) loaded on the page.`);
            }
            console.log(`[Processing] Only ${count} tweet found. Continuing anyway...`);
        }

        // Let it settle for 3 seconds before starting scroll/expand interactions
        await wait(3000);

        // Perform scroll and expand sequence
        await scrollAndExpandThread(page);

        console.log(`[Processing] Settling at the bottom of the thread...`);
        await wait(2000);

        // Upscale image URLs in the DOM to HD PNG (while maintaining standard 1920x1080 viewport)
        console.log(`[Processing] Upscaling image URLs in DOM to HD PNG...`);
        await upgradeImagesToHD(page);

        // Wait for images to load fully
        console.log(`[Processing] Waiting for upscaled HD images to finish loading...`);
        await waitForImagesToLoad(page);
        await wait(3000); // Settle wait

        // Final network settle wait
        try {
            console.log(`[Processing] Waiting for network idle...`);
            await page.waitForNetworkIdle({ idleTime: 1500, timeout: 15000 });
        } catch (e) {
            console.log(`[Warning] networkidle timeout occurred.`);
        }

        // Run SingleFile serialization inside try-finally block to guarantee viewport restoration
        console.log(`[Serialization] Serialization started...`);
        let htmlData;
        try {
            // 1. Temporarily expand viewport to document scrollHeight and scroll to top right before serialization
            // This mounts all virtualized tweets in the DOM just for the HTML extraction
            const scrollHeight = await page.evaluate('document.documentElement.scrollHeight');
            console.log(`[Serialization] Temporarily expanding viewport height to document scrollHeight (${scrollHeight}px)...`);
            await page.setViewport({ width: 1920, height: scrollHeight });
            await page.evaluate(() => {
                window.scrollTo(0, 0);
            });
            await wait(2500); // Let React mount elements in the expanded viewport

            const scriptContent = await getSingleFileBundle();
            // Append explicit assignment to window.singlefile to resolve Puppeteer execution wrapper scoping
            const scriptWithExport = scriptContent + "\nwindow.singlefile = singlefile;";
            await page.evaluate(scriptWithExport);

            htmlData = await page.evaluate(async () => {
                const options = {};
                const pageData = await window.singlefile.getPageData(options);
                return pageData.content;
            });
        } finally {
            // 2. Immediately restore standard viewport
            try {
                console.log(`[Serialization] Restoring standard viewport (1920x1080)...`);
                await page.setViewport({ width: 1920, height: 1080 });
                await page.evaluate(() => {
                    window.scrollTo(0, 0);
                });
            } catch (vpErr) {
                console.error(`[Warning] Failed to restore viewport: ${vpErr.message}`);
            }
        }

        if (htmlData.length < 50 * 1024) {
            console.log(`[Warning] Output file size is unexpectedly small: ${htmlData.length} bytes`);
        }
        if (!htmlData.includes('data:image/')) {
            console.log(`[Warning] No Base64 images found in output.`);
        }

        fs.writeFileSync(outputPath, htmlData, 'utf8');
        appendLine(COMPLETED_FILE, url);
        console.log(`[Success] Saved offline archive to: ${outputPath}`);

        return true;

    } catch (e) {
        console.error(`[Error] Failed to process ${url}: ${e.message}`);
        // Ensure standard viewport is restored on failure (if page is still open)
        try {
            if (page && !page.isClosed()) {
                await page.setViewport({ width: 1920, height: 1080 });
            }
        } catch (vpErr) { }

        if (retryCount < 1) {
            console.log(`[Retry] Retrying in 15 seconds...`);
            await wait(15000);

            // If the page was closed or crashed, create a new one for the retry
            let activePage = page;
            try {
                if (!browser.isConnected()) {
                    console.log(`[Retry] Browser disconnected. We cannot retry.`);
                    return false;
                }
                if (!activePage || activePage.isClosed()) {
                    console.log(`[Retry] Page was closed/crashed. Creating a new page context...`);
                    activePage = await browser.newPage();
                }
            } catch (err) {
                console.error(`[Retry Error] Failed to prepare page for retry: ${err.message}`);
            }

            return await processUrl(browser, activePage, url, cookies, retryCount + 1);
        } else {
            appendLine(FAILED_FILE, `${new Date().toISOString()} - ${url} - ${e.message}`);
            return false;
        }
    }
}

async function main() {
    console.log("Starting Twitter Protected Thread Archiver...");

    // Load cookies
    let cookies = [];
    try {
        cookies = loadNetscapeCookies(COOKIES_FILE);
    } catch (err) {
        console.error(`❌ CRITICAL COOKIE ERROR: ${err.message}`);
        console.error("Please verify that cookies.txt is present in the parent directory.");
        process.exit(1);
    }

    let urls = await readLines(URLS_TWITTERTHREAD);

    if (urls.length === 0) {
        console.log("No URLs found to process in urls_twitterthread.txt.");
        return;
    }

    const completed = await readLines(COMPLETED_FILE);
    const completedSet = new Set(completed);

    urls = urls.filter(u => !completedSet.has(u));
    console.log(`Total URLs to process: ${urls.length}`);

    if (urls.length === 0) {
        console.log("All URLs are already marked completed.");
        return;
    }

    // Launch with headless: false as requested for manual visibility and validation.
    // Once everything is confirmed, you can change headless to true.
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        console.log(`\n[${i + 1}/${urls.length}]`);

        const success = await processUrl(browser, page, url, cookies);
        if (success) {
            successCount++;
        } else {
            failCount++;
        }

        if (i < urls.length - 1) {
            const delay = Math.floor(Math.random() * 4000) + 4000; // 4s - 8s random delay
            console.log(`Waiting ${delay}ms before next thread...`);
            await wait(delay);
        }
    }

    console.log("\n========================================");
    console.log("  TWITTER ARCHIVING COMPLETE");
    console.log("========================================");
    console.log(`  Total URLs:        ${urls.length}`);
    console.log(`  Successfully saved: ${successCount}`);
    console.log(`  Failed:             ${failCount}  → see failed.txt`);
    console.log("========================================");

    // Keep browser open for verification as requested by user
    console.log("\nBrowser kept open for your verification. Press Ctrl+C in terminal to exit.");
}

main().catch(console.error);
