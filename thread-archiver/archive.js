const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const esbuild = require('esbuild');

puppeteer.use(StealthPlugin());

const OUTPUT_DIR = path.join(__dirname, 'output');
const COMPLETED_FILE = path.join(__dirname, 'completed.txt');
const FAILED_FILE = path.join(__dirname, 'failed.txt');
const URLS_THREADREADER = path.join(__dirname, 'urls_threadreader.txt');
const URLS_TWITTERTHREAD = path.join(__dirname, 'urls_twitterthread.txt');

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
            let totalHeight = 0;
            const distance = 500;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight - window.innerHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 400);
        });
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
        
        console.log(`[Processing] ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Check for unroll button
        try {
            const unrollBtn = await page.$('button, a[class*="unroll"], div[role="button"]');
            if (unrollBtn) {
                const text = await page.evaluate(el => el.textContent, unrollBtn);
                if (/unroll|read full/i.test(text)) {
                    await unrollBtn.click();
                    await wait(3000);
                }
            }
        } catch (e) {
            // ignore
        }

        await performPacedScroll(page);
        
        // Wait for network idle 0
        try {
            await page.waitForNetworkIdle({ idleTime: 500, timeout: 60000 });
        } catch (e) {
            console.log(`[Warning] networkidle0 timeout for ${url}`);
        }

        const content = await page.content();
        if (content.includes('cloudflare-challenge') || content.includes('Just a moment...')) {
            throw new Error('Cloudflare challenge detected');
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
