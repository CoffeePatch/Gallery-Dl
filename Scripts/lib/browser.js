const esbuild = require('esbuild');
const { getLosslessSnapshotUrl } = require('./download');

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

module.exports = {
    performPacedScroll,
    forceLoadLazyImages,
    waitForImagesToLoad,
    upgradeImagesToHD,
    getSingleFileBundle
};
