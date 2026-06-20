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

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// wait function
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function readLines(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

function appendLine(filePath, line) {
    fs.appendFileSync(filePath, line + '\n', 'utf8');
}

async function performPacedScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let lastScrollTop = -1;
            let lastScrollHeight = -1;
            let sameCount = 0;
            const distance = 400; // Scroll step in pixels
            const interval = 200; // Interval in ms
            const maxSameCount = 10; // Wait at bottom for 2.0s (10 * 200ms) for new content/images

            const timer = setInterval(() => {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const scrollHeight = document.documentElement.scrollHeight;
                const clientHeight = document.documentElement.clientHeight;

                window.scrollBy(0, distance);

                // If scroll position didn't change and scroll height didn't change, increment counter
                if (scrollTop === lastScrollTop && scrollHeight === lastScrollHeight) {
                    sameCount++;
                } else {
                    sameCount = 0;
                }

                lastScrollTop = scrollTop;
                lastScrollHeight = scrollHeight;

                // Check if we are at the bottom of the page
                const isAtBottom = (scrollTop + clientHeight >= scrollHeight - 50);

                if (isAtBottom) {
                    if (sameCount >= maxSameCount) {
                        clearInterval(timer);
                        resolve();
                    }
                } else {
                    // Safety timeout if stuck in the middle for some reason
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
        let count = 0;
        for (const img of images) {
            const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('lazy-src');
            if (dataSrc) {
                const currentSrc = img.getAttribute('src');
                if (currentSrc !== dataSrc) {
                    img.setAttribute('src', dataSrc);
                    count++;
                }
            }
            // Check for srcset as well
            const dataSrcset = img.getAttribute('data-srcset');
            if (dataSrcset) {
                const currentSrcset = img.getAttribute('srcset');
                if (currentSrcset !== dataSrcset) {
                    img.setAttribute('srcset', dataSrcset);
                }
            }
        }
        if (count > 0) {
            console.log(`[JS] Force-loaded ${count} lazy-loaded images.`);
        }
    });
}

async function waitForImagesToLoad(page) {
    console.log(`[Processing] Waiting for all images to complete loading...`);
    await page.evaluate(async () => {
        const imgs = Array.from(document.querySelectorAll('img'));
        const promises = imgs.map(img => {
            // If the image is already loaded, resolve immediately
            if (img.complete && img.naturalWidth > 0) {
                return Promise.resolve();
            }
            // Otherwise, wait for load or error
            return new Promise((resolve) => {
                img.addEventListener('load', () => resolve());
                img.addEventListener('error', () => resolve());
                // Set a timeout of 15 seconds per image as a safeguard
                setTimeout(resolve, 15000);
            });
        });
        await Promise.all(promises);
    });
}

function extractThreadId(url) {
    const match = url.match(/\/(\d+)(?:\.html)?$/);
    return match ? match[1] : null;
}

// Global variable to hold the bundled single-file script
let singleFileBundle = null;

async function getSingleFileBundle() {
    if (singleFileBundle) return singleFileBundle;
    // We bundle single-file-core using esbuild so it can be injected into the browser context
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

async function processUrl(browser, url, retryCount = 0) {
    let page;
    try {
        const threadId = extractThreadId(url);
        if (!threadId) {
            throw new Error(`Cannot extract thread ID from URL`);
        }
        
        const outputPath = path.join(OUTPUT_DIR, `${threadId}.html`);
        if (fs.existsSync(outputPath)) {
            console.log(`[Skip] Already archived: ${url}`);
            return true;
        }

        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Enable request interception to bypass Twitter CDN origin blocks
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            const headers = Object.assign({}, request.headers());
            if (url.includes('twimg.com')) {
                delete headers['origin'];
                delete headers['referer'];
                request.continue({ headers });
            } else {
                request.continue();
            }
        });
        
        console.log(`[Processing] ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Check for Cloudflare challenge immediately
        const initialContent = await page.content();
        if (initialContent.includes('cloudflare-challenge') || initialContent.includes('Just a moment...')) {
            throw new Error('Cloudflare challenge detected');
        }

        // Perform paced scrolling to trigger dynamic elements and content loading
        await performPacedScroll(page);
        
        // Programmatically swap data-src attributes to src for all lazy-loaded images
        await forceLoadLazyImages(page);
        
        // Wait for all image network requests and layout decodes to complete
        await waitForImagesToLoad(page);
        
        // Wait for network to settle
        try {
            console.log(`[Processing] Waiting for network idle...`);
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 20000 });
        } catch (e) {
            console.log(`[Warning] networkidle timeout for ${url}`);
        }

        // Double check Cloudflare challenge wasn't triggered during interaction
        const finalContent = await page.content();
        if (finalContent.includes('cloudflare-challenge') || finalContent.includes('Just a moment...')) {
            throw new Error('Cloudflare challenge detected post-load');
        }

        // Inject single-file core
        const scriptContent = await getSingleFileBundle();
        await page.addScriptTag({ content: scriptContent });
        
        const htmlData = await page.evaluate(async () => {
            // singlefile is the globalName we used in esbuild
            const options = {};
            const pageData = await window.singlefile.getPageData(options);
            return pageData.content;
        });

        if (htmlData.length < 50 * 1024) {
            console.log(`[Warning] Output file size is less than 50KB for ${url}`);
        }
        if (!htmlData.includes('data:image/')) {
            console.log(`[Warning] No Base64 images found in output for ${url}`);
        }

        fs.writeFileSync(outputPath, htmlData, 'utf8');
        appendLine(COMPLETED_FILE, url);
        console.log(`[Success] Saved ${outputPath}`);
        
        await page.close();
        return true;

    } catch (e) {
        console.error(`[Error] Failed to process ${url}: ${e.message}`);
        if (page) {
            try { await page.close(); } catch(err) {}
        }
        if (retryCount < 1) {
            console.log(`[Retry] Waiting 20 seconds before retrying ${url}`);
            await wait(20000);
            return await processUrl(browser, url, retryCount + 1);
        } else {
            appendLine(FAILED_FILE, `${new Date().toISOString()} - ${url} - ${e.message}`);
            return false;
        }
    }
}

async function main() {
    console.log("Starting Thread Archiver...");
    
    let urls = [];
    const threadreaderUrls = await readLines(URLS_THREADREADER);
    const twitterthreadUrls = await readLines(URLS_TWITTERTHREAD);
    urls = [...threadreaderUrls, ...twitterthreadUrls];
    
    if (urls.length === 0) {
        console.log("No URLs found to process.");
        return;
    }

    const completed = await readLines(COMPLETED_FILE);
    const completedSet = new Set(completed);
    
    urls = urls.filter(u => !completedSet.has(u));
    
    console.log(`Total URLs to process: ${urls.length}`);

    let browser = await puppeteer.launch({ headless: 'new' });
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        console.log(`\n[${i+1}/${urls.length}]`);
        
        const success = await processUrl(browser, url);
        if (success) {
            successCount++;
        } else {
            failCount++;
        }

        // Random delay 3-7s
        if (i < urls.length - 1) {
            const delay = Math.floor(Math.random() * 4000) + 3000;
            console.log(`Waiting ${delay}ms...`);
            await wait(delay);
        }

        // Restart browser every 50 URLs
        if ((i + 1) % 50 === 0 && i < urls.length - 1) {
            console.log("Restarting browser to clear memory...");
            await browser.close();
            browser = await puppeteer.launch({ headless: 'new' });
        }
    }

    await browser.close();

    console.log("\n========================================");
    console.log("  ARCHIVING COMPLETE");
    console.log("========================================");
    console.log(`  Total URLs:        ${urls.length}`);
    console.log(`  Successfully saved: ${successCount}`);
    console.log(`  Failed:             ${failCount}  → see failed.txt`);
    console.log("========================================");
}

main().catch(console.error);
