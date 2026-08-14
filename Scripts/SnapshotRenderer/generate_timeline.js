const fs = require('fs');
const path = require('path');
const { parseRecord } = require('../lib/recordSchema');
const { RAW_DATA_DIR, MEDIA_DIR, TWEET_DATA_DIR } = require('../lib/paths');
const { getBulkDownloadUrl } = require('../lib/download');
const { streamRecordsFromFile } = require('../lib/streamingMerger');

const cssTemplate = fs.readFileSync(path.join(__dirname, 'templates', 'timeline.css'), 'utf8');

function getIcons() {
    return {
        reply: '<svg viewBox="0 0 24 24"><g><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"></path></g></svg>',
        repost: '<svg viewBox="0 0 24 24"><g><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"></path></g></svg>',
        like: '<svg viewBox="0 0 24 24"><g><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"></path></g></svg>',
        view: '<svg viewBox="0 0 24 24"><g><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z"></path></g></svg>'
    };
}

const additionalCss = `
/* Navigation & Index styles */
.timeline-navigation {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #2f3336;
    background-color: #000000;
}
.nav-btn {
    color: #1d9bf0;
    text-decoration: none;
    font-weight: 700;
    font-size: 14px;
    padding: 6px 16px;
    border: 1px solid #2f3336;
    border-radius: 9999px;
    transition: background-color 0.2s;
    display: inline-block;
}
.nav-btn:hover:not(.disabled) {
    background-color: rgba(29, 155, 240, 0.1);
}
.nav-btn.disabled {
    color: #71767b;
    cursor: not-allowed;
    border-color: #2f3336;
    background-color: transparent;
}
.nav-page-num {
    font-size: 14px;
    color: #71767b;
    font-weight: 600;
}
.index-container {
    max-width: 600px;
    margin: 0 auto;
    border-left: 1px solid #2f3336;
    border-right: 1px solid #2f3336;
    min-height: 100vh;
    padding: 24px;
    box-sizing: border-box;
}
.index-header {
    margin-bottom: 32px;
    border-bottom: 1px solid #2f3336;
    padding-bottom: 16px;
}
.index-header h1 {
    font-size: 28px;
    font-weight: 800;
    margin: 0 0 8px 0;
}
.index-header p {
    color: #71767b;
    font-size: 15px;
    margin: 0;
}
.index-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
}
.index-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border: 1px solid #2f3336;
    border-radius: 16px;
    text-decoration: none;
    color: inherit;
    transition: background-color 0.2s, border-color 0.2s;
}
.index-card:hover {
    background-color: rgba(255, 255, 255, 0.03);
    border-color: #1d9bf0;
}
.index-card-title {
    font-weight: 700;
    font-size: 16px;
    color: #1d9bf0;
    margin-bottom: 4px;
}
.index-card-meta {
    font-size: 13px;
    color: #71767b;
}
.index-card-count {
    background-color: #2f3336;
    color: #e7e9ea;
    padding: 4px 12px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 700;
}
const PAGE_STYLE = cssTemplate + additionalCss;

const PAGE_SCRIPT = `
function handleImageError(img) {
    if (img.dataset.local1 && img.src !== img.dataset.local1 && !img.dataset.triedLocal1) {
        img.dataset.triedLocal1 = "true";
        img.src = img.dataset.local1;
    } else if (img.dataset.local2 && img.src !== img.dataset.local2 && !img.dataset.triedLocal2) {
        img.dataset.triedLocal2 = "true";
        img.src = img.dataset.local2;
    } else {
        img.onerror = null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Video poster fallback
    document.querySelectorAll('video').forEach(video => {
        const poster = video.getAttribute('poster');
        if (poster) {
            const img = new Image();
            img.src = poster;
            img.onerror = () => {
                const local1 = video.getAttribute('data-poster-local1');
                if (local1) {
                    const imgLocal1 = new Image();
                    imgLocal1.src = local1;
                    imgLocal1.onload = () => {
                        video.setAttribute('poster', local1);
                    };
                    imgLocal1.onerror = () => {
                        const local2 = video.getAttribute('data-poster-local2');
                        if (local2) {
                            video.setAttribute('poster', local2);
                        }
                    };
                }
            };
        }
    });

    // Video IntersectionObserver for lazy loading and scrolling play/pause
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target;
            if (entry.isIntersecting) {
                if (video.preload === 'none') {
                    video.preload = 'metadata';
                }
            } else {
                if (!video.paused) {
                    video.pause();
                }
            }
        });
    }, { rootMargin: '100px 0px', threshold: 0.01 });

    document.querySelectorAll('video').forEach(video => {
        observer.observe(video);
    });
});
`;


function getMediaPaths(mappedPath, outDir) {
    const mediaDir = path.join(__dirname, '..', 'TweetData', 'Media');
    const relativeToOut = path.relative(outDir, mediaDir);
    const directRelative = path.join(relativeToOut, mappedPath).replace(/\\/g, '/');
    const internalRelative = `./Media/${mappedPath}`.replace(/\\/g, '/');
    return { directRelative, internalRelative };
}

function buildImageHtml(img, outDir, mediaMap) {
    const normUrl = getBulkDownloadUrl(img.url);
    const mappedPath = mediaMap[normUrl];
    const webUrl = img.url;
    
    if (mappedPath) {
        const absolutePath = path.join(__dirname, '..', 'TweetData', 'Media', mappedPath);
        if (fs.existsSync(absolutePath)) {
            const { directRelative, internalRelative } = getMediaPaths(mappedPath, outDir);
            return `<img src="${webUrl}" data-local1="${directRelative}" data-local2="${internalRelative}" alt="Image" loading="lazy" onerror="handleImageError(this)">`;
        }
    }
    return `<img src="${webUrl}" alt="Image" loading="lazy">`;
}

function buildImageBase64Html(img, mediaMap, outDir) {
    const normUrl = getBulkDownloadUrl(img.url);
    const mappedPath = mediaMap[normUrl];
    const webUrl = img.url;
    
    if (mappedPath) {
        const absolutePath = path.join(__dirname, '..', 'TweetData', 'Media', mappedPath);
        if (fs.existsSync(absolutePath)) {
            try {
                const ext = path.extname(absolutePath).toLowerCase();
                let mimeType = 'image/jpeg';
                if (ext === '.png') mimeType = 'image/png';
                else if (ext === '.gif') mimeType = 'image/gif';
                else if (ext === '.webp') mimeType = 'image/webp';
                else if (ext === '.svg') mimeType = 'image/svg+xml';
                
                const base64Data = fs.readFileSync(absolutePath).toString('base64');
                const dataUri = `data:${mimeType};base64,${base64Data}`;
                return `<img src="${dataUri}" alt="Image" loading="lazy">`;
            } catch (e) {
                console.error(`Error encoding image ${absolutePath} to base64:`, e.message);
            }
        }
    }
    return `<img src="${webUrl}" alt="Image" loading="lazy">`;
}

function buildVideoHtml(video, outDir, mediaMap) {
    const normUrl = getBulkDownloadUrl(video.url);
    const mappedPath = mediaMap[normUrl];
    const webUrl = video.url;
    const posterUrl = webUrl.replace('.mp4', '.jpg');
    
    let posterAttr = `poster="${posterUrl}"`;
    let sources = `<source src="${webUrl}" type="video/mp4">`;
    
    if (mappedPath) {
        const absolutePath = path.join(__dirname, '..', 'TweetData', 'Media', mappedPath);
        if (fs.existsSync(absolutePath)) {
            const { directRelative, internalRelative } = getMediaPaths(mappedPath, outDir);
            const directPoster = directRelative.replace('.mp4', '.jpg');
            const internalPoster = internalRelative.replace('.mp4', '.jpg');
            
            posterAttr = `poster="${posterUrl}" data-poster-local1="${directPoster}" data-poster-local2="${internalPoster}"`;
            
            sources += `
            <source src="${directRelative}" type="video/mp4">
            <source src="${internalRelative}" type="video/mp4">`;
        }
    }
    
    return `
    <div class="video-container">
        <video controls loop preload="none" ${posterAttr}>
            ${sources}
            Your browser does not support the video tag.
        </video>
    </div>`;
}

function buildTweetHtml(tweet, mediaByTweet, mediaMap, outDir, useBase64, targetAccount) {
    const isRetweet = tweet.retweet_id !== undefined && tweet.retweet_id !== 0 && tweet.retweet_id !== null;
    const author = tweet.author || targetAccount;
    const reposter = tweet.user || targetAccount;
    const icons = getIcons();
    
    let repostHeader = '';
    if (isRetweet) {
        repostHeader = `
        <div class="repost-indicator">
            ${icons.repost}
            <span>${reposter ? reposter.nick : 'User'} Reposted</span>
        </div>`;
    }

    const dateStr = new Date(tweet.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    let mediaHtml = '';
    const tMedia = mediaByTweet[tweet.tweet_id] || [];
    if (tMedia.length > 0) {
        tMedia.sort((a, b) => a.meta.num - b.meta.num);
        
        const videos = tMedia.filter(m => m.meta.type === 'video' || m.meta.type === 'animated_gif');
        const images = tMedia.filter(m => m.meta.type === 'image' || m.meta.type === 'photo');

        if (videos.length > 0) {
            mediaHtml = buildVideoHtml(videos[0], outDir, mediaMap);
        } else if (images.length > 0) {
            let gridClass = `media-grid-${Math.min(images.length, 4)}`;
            mediaHtml = `<div class="media-grid ${gridClass}">`;
            images.slice(0, 4).forEach(img => {
                if (useBase64) {
                    mediaHtml += buildImageBase64Html(img, mediaMap, outDir);
                } else {
                    mediaHtml += buildImageHtml(img, outDir, mediaMap);
                }
            });
            mediaHtml += `</div>`;
        }
    }

    const avatarUrl = author && author.profile_image ? author.profile_image : '';

    return `
    <div class="tweet" data-tweet-id="${tweet.tweet_id}">
        <div>
            <img src="${avatarUrl}" alt="" class="avatar" loading="lazy">
        </div>
        <div class="tweet-content">
            ${repostHeader}
            <div class="tweet-header">
                <a href="https://x.com/${author ? author.name : 'user'}" target="_blank" class="name">${author ? author.nick : 'User'}</a>
                <span class="handle">@${author ? author.name : 'user'}</span>
                <span class="date">· <a href="https://x.com/${author ? author.name : 'user'}/status/${tweet.tweet_id}" target="_blank" style="color: inherit; text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${dateStr}</a></span>
                <span class="date" style="margin-left: auto; font-size: 12px; cursor: help;" title="Original Tweet ID">ID: ${tweet.tweet_id}</span>
            </div>
            <div class="text">${tweet.content || ''}</div>
            ${mediaHtml}
            <div class="stats">
                <div class="stat" title="Reply">
                    ${icons.reply} <span>${tweet.reply_count || 0}</span>
                </div>
                <div class="stat" title="Repost">
                    ${icons.repost} <span>${tweet.retweet_count || 0}</span>
                </div>
                <div class="stat" title="Like">
                    ${icons.like} <span>${tweet.favorite_count || 0}</span>
                </div>
                <div class="stat" title="View">
                    ${icons.view} <span>${tweet.view_count || 0}</span>
                </div>
            </div>
        </div>
    </div>`;
}

function generateSingleFileHtml(tweets, mediaByTweet, mediaMap, outHtmlPath, targetAccount) {
    const outDir = path.dirname(outHtmlPath);
    fs.mkdirSync(outDir, { recursive: true });

    const writeStream = fs.createWriteStream(outHtmlPath, { encoding: 'utf8' });
    writeStream.write(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${targetAccount ? targetAccount.nick : 'Timeline'}</title>
    <style>${PAGE_STYLE}</style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${targetAccount ? targetAccount.nick : 'Archive'}</h1>
            <p>${tweets.length} posts</p>
        </div>
`);

    tweets.forEach(tweet => {
        writeStream.write(buildTweetHtml(tweet, mediaByTweet, mediaMap, outDir, false, targetAccount));
    });

    writeStream.write(`
    </div>
    <script>${PAGE_SCRIPT}</script>
</body>
</html>`);

    writeStream.end();
}

function generateIndexPage(pages, outPaginatedDir, targetAccount, totalTweets) {
    const indexPath = path.join(outPaginatedDir, 'index.html');
    
    let gridHtml = '';
    pages.forEach(p => {
        const oldestStr = p.oldestDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const newestStr = p.newestDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        
        gridHtml += `
        <a href="${p.fileName}" class="index-card">
            <div>
                <div class="index-card-title">Page ${p.pageNum}</div>
                <div class="index-card-meta">${oldestStr} - ${newestStr}</div>
            </div>
            <div class="index-card-count">${p.count} posts</div>
        </a>`;
    });
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${targetAccount ? targetAccount.nick : 'Archive'} - Timeline Index</title>
    <style>${PAGE_STYLE}</style>
</head>
<body>
    <div class="index-container">
        <div class="index-header">
            <h1>${targetAccount ? targetAccount.nick : 'Archive'}</h1>
            <p>Timeline Archive Index &bull; ${totalTweets} posts across ${pages.length} pages</p>
        </div>
        <div class="index-grid">
            ${gridHtml}
        </div>
    </div>
</body>
</html>`;
    
    fs.writeFileSync(indexPath, html, 'utf8');
}

function generatePaginatedTimeline(tweets, mediaByTweet, mediaMap, outPaginatedDir, targetAccount, thresholdBytes) {
    fs.mkdirSync(outPaginatedDir, { recursive: true });

    let pages = [];
    let pageNum = 1;
    let pageTweets = [];
    let runningBytes = 0;
    
    const scaffoldingHeader = (pageNum) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${targetAccount ? targetAccount.nick : 'Timeline'} - Page ${pageNum}</title>
    <style>${PAGE_STYLE}</style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${targetAccount ? targetAccount.nick : 'Archive'}</h1>
            <p>Page ${pageNum}</p>
        </div>
`;

    const scaffoldingFooter = `
    </div>
    <script>${PAGE_SCRIPT}</script>
</body>
</html>`;

    function writePage(pNum, tweetsList, isLast) {
        const fileName = `page_${String(pNum).padStart(3, '0')}.html`;
        const filePath = path.join(outPaginatedDir, fileName);
        const navHtml = getNavigationHtml(pNum, isLast);
        
        const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
        stream.write(scaffoldingHeader(pNum));
        stream.write(navHtml);
        
        tweetsList.forEach(t => {
            stream.write(t.html);
        });
        
        stream.write(navHtml);
        stream.write(scaffoldingFooter);
        stream.end();
        
        if (tweetsList.length > 0) {
            const oldestTweet = tweetsList[tweetsList.length - 1].raw;
            const newestTweet = tweetsList[0].raw;
            pages.push({
                fileName,
                pageNum: pNum,
                count: tweetsList.length,
                oldestDate: new Date(oldestTweet.date),
                newestDate: new Date(newestTweet.date)
            });
        }
    }

    function getNavigationHtml(pageNum, isLastPage) {
        const prevPage = pageNum > 1 ? `page_${String(pageNum - 1).padStart(3, '0')}.html` : null;
        const nextPage = !isLastPage ? `page_${String(pageNum + 1).padStart(3, '0')}.html` : null;
        
        return `
        <div class="timeline-navigation">
            ${prevPage ? `<a href="${prevPage}" class="nav-btn">&larr; Previous Page</a>` : `<span class="nav-btn disabled">&larr; Previous Page</span>`}
            <span class="nav-page-num">Page ${pageNum}</span>
            ${nextPage ? `<a href="${nextPage}" class="nav-btn">Next Page &rarr;</a>` : `<span class="nav-btn disabled">Next Page &rarr;</span>`}
        </div>
        `;
    }

    for (let i = 0; i < tweets.length; i++) {
        const tweet = tweets[i];
        
        let tweetHtml = buildTweetHtml(tweet, mediaByTweet, mediaMap, outPaginatedDir, true, targetAccount);
        let tweetSize = Buffer.byteLength(tweetHtml, 'utf8');
        
        if (tweetSize > 2 * thresholdBytes) {
            console.log(`[Warning] Tweet ${tweet.tweet_id} size (${(tweetSize / (1024 * 1024)).toFixed(2)} MB) exceeds 2x threshold. Falling back to relative paths.`);
            tweetHtml = buildTweetHtml(tweet, mediaByTweet, mediaMap, outPaginatedDir, false, targetAccount);
            tweetSize = Buffer.byteLength(tweetHtml, 'utf8');
        }
        
        if (runningBytes + tweetSize > thresholdBytes && pageTweets.length > 0) {
            writePage(pageNum, pageTweets, false);
            pageNum++;
            pageTweets = [];
            runningBytes = 0;
        }
        
        pageTweets.push({ raw: tweet, html: tweetHtml });
        runningBytes += tweetSize;
    }
    
    if (pageTweets.length > 0) {
        writePage(pageNum, pageTweets, true);
    }
    
    generateIndexPage(pages, outPaginatedDir, targetAccount, tweets.length);
}

async function processFile(filePath, outHtmlPath, outPaginatedDir, options) {
    let tweets = [];
    let mediaByTweet = {};
    let targetAccount = null;

    await streamRecordsFromFile(filePath, (record) => {
        const parsed = parseRecord(record);
        if (parsed.isLegacy) {
            tweets.push(parsed.dataObj);
            if (!targetAccount && parsed.dataObj.user && parsed.dataObj.user.name) {
                targetAccount = parsed.dataObj.user;
            }
        } else if (parsed.isMedia) {
            const url = parsed.mediaUrl;
            const meta = parsed.dataObj;
            const tid = parsed.tweetId;
            if (tid) {
                if (!mediaByTweet[tid]) mediaByTweet[tid] = [];
                mediaByTweet[tid].push({ url, meta });
            }
        }
    });

    tweets.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const mappingFileName = `${path.basename(filePath, '.json')}_media_map.json`;
    const mappingDir = path.join(MEDIA_DIR, 'Mappings');
    const mappingPath = path.join(mappingDir, mappingFileName);
    
    let mediaMap = {};
    if (fs.existsSync(mappingPath)) {
        try {
            mediaMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
        } catch (e) {
            console.error(`Warning: Failed to load media map from ${mappingPath}:`, e.message);
        }
    }

    if (options.type === 'single' || options.type === 'both') {
        console.log(`Generating single-file HTML at ${outHtmlPath}...`);
        generateSingleFileHtml(tweets, mediaByTweet, mediaMap, outHtmlPath, targetAccount);
    }
    
    if (options.type === 'paginated' || options.type === 'both') {
        console.log(`Generating paginated HTML at ${outPaginatedDir}...`);
        generatePaginatedTimeline(tweets, mediaByTweet, mediaMap, outPaginatedDir, targetAccount, options.thresholdBytes);
    }
}

async function main() {
    const args = process.argv.slice(2);
    let isBatch = false;
    let inputPath = '';
    let type = 'both';
    let thresholdMb = 50;

    const typeIndex = args.indexOf('--type');
    if (typeIndex !== -1 && args[typeIndex + 1]) {
        type = args[typeIndex + 1].toLowerCase();
    }
    const thresholdIndex = args.indexOf('--threshold');
    if (thresholdIndex !== -1 && args[thresholdIndex + 1]) {
        thresholdMb = parseFloat(args[thresholdIndex + 1]) || 50;
    }

    if (args.includes('--batch')) {
        isBatch = true;
        const index = args.indexOf('--batch');
        const nextArg = args[index + 1];
        if (nextArg && !nextArg.startsWith('--')) {
            inputPath = nextArg;
        } else {
            inputPath = RAW_DATA_DIR;
        }
    } else {
        for (let i = 0; i < args.length; i++) {
            if (args[i].startsWith('--')) {
                if (['--type', '--threshold'].includes(args[i])) {
                    i++;
                }
                continue;
            }
            inputPath = args[i];
            break;
        }
    }

    if (!inputPath) {
        console.error("Please provide an input file or --batch <directory>");
        process.exit(1);
    }

    const options = {
        type,
        thresholdBytes: thresholdMb * 1024 * 1024
    };

    if (isBatch) {
        const outDir = path.join(TWEET_DATA_DIR, 'TimeLineOutput');
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        const files = fs.readdirSync(inputPath).filter(f => f.endsWith('.json'));
        console.log(`Found ${files.length} JSON files to process.`);
        
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const p = path.join(inputPath, f);
            console.log(`[${i+1}/${files.length}] Processing ${f}...`);
            const outHtmlPath = path.join(outDir, f.replace('.json', '.html'));
            const outPaginatedDir = path.join(outDir, f.replace('.json', '_paginated'));
            await processFile(p, outHtmlPath, outPaginatedDir, options);
        }
        console.log(`Batch processing complete. Output in ${outDir}`);
    } else {
        console.log(`Processing ${inputPath}...`);
        const parsed = path.parse(inputPath);
        const outHtmlPath = path.join(parsed.dir, parsed.name + '.html');
        const outPaginatedDir = path.join(parsed.dir, parsed.name + '_paginated');
        await processFile(inputPath, outHtmlPath, outPaginatedDir, options);
        console.log(`Done!`);
    }
}

main().catch((err) => {
    console.error(`[TIMELINE ERROR] ${err.stack || err.message}`);
    process.exit(1);
});
