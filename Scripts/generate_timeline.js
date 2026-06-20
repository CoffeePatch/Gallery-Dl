const fs = require('fs');
const path = require('path');

const cssTemplate = `
body {
    background-color: #000000;
    color: #e7e9ea;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 0;
    padding: 0;
    line-height: 1.5;
}
.container {
    max-width: 600px;
    margin: 0 auto;
    border-left: 1px solid #2f3336;
    border-right: 1px solid #2f3336;
    min-height: 100vh;
}
.header {
    padding: 16px;
    border-bottom: 1px solid #2f3336;
    position: sticky;
    top: 0;
    background-color: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(12px);
    z-index: 10;
}
.header h1 {
    font-size: 20px;
    font-weight: 700;
    margin: 0;
}
.header p {
    font-size: 13px;
    color: #71767b;
    margin: 0;
}
.tweet {
    padding: 16px;
    border-bottom: 1px solid #2f3336;
    display: flex;
    gap: 12px;
    cursor: pointer;
    transition: background-color 0.2s;
}
.tweet:hover {
    background-color: rgba(255, 255, 255, 0.03);
}
.avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    object-fit: cover;
    background-color: #333;
}
.tweet-content {
    flex: 1;
    min-width: 0;
}
.tweet-header {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 4px;
    flex-wrap: wrap;
}
.name {
    font-weight: 700;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #e7e9ea;
    text-decoration: none;
}
.name:hover {
    text-decoration: underline;
}
.handle {
    color: #71767b;
    font-size: 15px;
}
.date {
    color: #71767b;
    font-size: 15px;
}
.text {
    font-size: 15px;
    margin-bottom: 12px;
    white-space: pre-wrap;
    word-wrap: break-word;
}
.media-grid {
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid #2f3336;
    margin-top: 12px;
}
.media-grid-1 {
    display: flex;
}
.media-grid-1 img, .media-grid-1 video {
    width: 100%;
    height: auto;
    max-height: 600px;
    object-fit: cover;
}
.media-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    height: 280px;
}
.media-grid-2 img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.media-grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 2px;
    height: 280px;
}
.media-grid-3 img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.media-grid-3 img:first-child {
    grid-row: span 2;
}
.media-grid-4 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 2px;
    height: 280px;
}
.media-grid-4 img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.video-container {
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid #2f3336;
    margin-top: 12px;
    display: flex;
}
.video-container video {
    width: 100%;
    max-height: 600px;
    background-color: #000;
}
.stats {
    display: flex;
    justify-content: space-between;
    max-width: 425px;
    color: #71767b;
    margin-top: 12px;
    font-size: 13px;
}
.stat {
    display: flex;
    align-items: center;
    gap: 8px;
}
.stat svg {
    fill: #71767b;
    width: 1.25em;
    height: 1.25em;
}
.repost-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #71767b;
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 4px;
    padding-left: 36px;
}
.repost-indicator svg {
    fill: #71767b;
    width: 16px;
    height: 16px;
}
`;

function getIcons() {
    return {
        reply: '<svg viewBox="0 0 24 24"><g><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"></path></g></svg>',
        repost: '<svg viewBox="0 0 24 24"><g><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"></path></g></svg>',
        like: '<svg viewBox="0 0 24 24"><g><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"></path></g></svg>',
        view: '<svg viewBox="0 0 24 24"><g><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z"></path></g></svg>'
    };
}

function processFile(filePath) {
    const rawData = fs.readFileSync(filePath, 'utf8');
    const records = JSON.parse(rawData);

    let tweets = [];
    let mediaByTweet = {};
    let targetAccount = null;

    records.forEach(record => {
        const type = record[0];
        if (type === 2) {
            tweets.push(record[1]);
            if (!targetAccount && record[1].user && record[1].user.name) {
                targetAccount = record[1].user;
            }
        } else if (type === 3) {
            const url = record[1];
            const meta = record[2];
            const tid = meta.tweet_id;
            if (!mediaByTweet[tid]) mediaByTweet[tid] = [];
            mediaByTweet[tid].push({ url, meta });
        }
    });

    tweets.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>\${targetAccount ? targetAccount.nick : 'Timeline'}</title>
    <style>\${cssTemplate}</style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>\${targetAccount ? targetAccount.nick : 'Archive'}</h1>
            <p>\${tweets.length} posts</p>
        </div>
`;

    tweets.forEach(tweet => {
        const isRetweet = tweet.retweet_id !== undefined && tweet.retweet_id !== 0 && tweet.retweet_id !== null;
        const author = tweet.author || targetAccount;
        const reposter = tweet.user || targetAccount;
        const icons = getIcons();
        
        let repostHeader = '';
        if (isRetweet) {
            repostHeader = `
            <div class="repost-indicator">
                \${icons.repost}
                <span>\${reposter.nick} Reposted</span>
            </div>`;
        }

        const dateStr = new Date(tweet.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

        let mediaHtml = '';
        const tMedia = mediaByTweet[tweet.tweet_id] || [];
        if (tMedia.length > 0) {
            tMedia.sort((a, b) => a.meta.num - b.meta.num);
            
            // Check for videos
            const videos = tMedia.filter(m => m.meta.type === 'video' || m.meta.type === 'animated_gif');
            const images = tMedia.filter(m => m.meta.type === 'image' || m.meta.type === 'photo');

            if (videos.length > 0) {
                // If there's a video, typically just show the first one
                mediaHtml = `
                <div class="video-container">
                    <video src="\${videos[0].url}" controls loop preload="none" poster="\${videos[0].url.replace('.mp4', '.jpg')}"></video>
                </div>`;
            } else if (images.length > 0) {
                let gridClass = `media-grid-\${Math.min(images.length, 4)}`;
                mediaHtml = `<div class="media-grid \${gridClass}">`;
                images.slice(0, 4).forEach(img => {
                    mediaHtml += `<img src="\${img.url}" alt="Image" loading="lazy">`;
                });
                mediaHtml += `</div>`;
            }
        }

        html += `
        <div class="tweet">
            <div>
                <img src="\${author ? author.profile_image : ''}" alt="" class="avatar" loading="lazy">
            </div>
            <div class="tweet-content">
                \${repostHeader}
                <div class="tweet-header">
                    <a href="https://x.com/\${author ? author.name : 'user'}" target="_blank" class="name">\${author ? author.nick : 'User'}</a>
                    <span class="handle">@\${author ? author.name : 'user'}</span>
                    <span class="date">· <a href="https://x.com/\${author ? author.name : 'user'}/status/\${tweet.tweet_id}" target="_blank" style="color: inherit; text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">\${dateStr}</a></span>
                    <span class="date" style="margin-left: auto; font-size: 12px; cursor: help;" title="Original Tweet ID">ID: \${tweet.tweet_id}</span>
                </div>
                <div class="text">\${tweet.content || ''}</div>
                \${mediaHtml}
                <div class="stats">
                    <div class="stat" title="Reply">
                        \${icons.reply} <span>\${tweet.reply_count || 0}</span>
                    </div>
                    <div class="stat" title="Repost">
                        \${icons.repost} <span>\${tweet.retweet_count || 0}</span>
                    </div>
                    <div class="stat" title="Like">
                        \${icons.like} <span>\${tweet.favorite_count || 0}</span>
                    </div>
                    <div class="stat" title="View">
                        \${icons.view} <span>\${tweet.view_count || 0}</span>
                    </div>
                </div>
            </div>
        </div>`;
    });

    html += `
    </div>
</body>
</html>`;

    return html;
}

function main() {
    const args = process.argv.slice(2);
    let isBatch = false;
    let inputPath = '';

    if (args.includes('--batch')) {
        isBatch = true;
        const index = args.indexOf('--batch');
        inputPath = args[index + 1] || '../TweetData/RawData';
    } else {
        inputPath = args[0];
    }

    if (!inputPath) {
        console.error("Please provide an input file or --batch <directory>");
        process.exit(1);
    }

    if (isBatch) {
        const outDir = path.join(__dirname, '..', 'TweetData', 'TimeLineOutput');
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        const files = fs.readdirSync(inputPath).filter(f => f.endsWith('.json'));
        console.log(`Found \${files.length} JSON files to process.`);
        
        files.forEach((f, i) => {
            const p = path.join(inputPath, f);
            console.log(`[\${i+1}/\${files.length}] Processing \${f}...`);
            const html = processFile(p);
            const outFile = path.join(outDir, f.replace('.json', '.html'));
            fs.writeFileSync(outFile, html, 'utf8');
        });
        console.log(`Batch processing complete. Output in \${outDir}`);
    } else {
        console.log(`Processing \${inputPath}...`);
        const html = processFile(inputPath);
        const parsed = path.parse(inputPath);
        const outFile = path.join(parsed.dir, parsed.name + '.html');
        fs.writeFileSync(outFile, html, 'utf8');
        console.log(`Done! Output saved to \${outFile}`);
    }
}

main();
