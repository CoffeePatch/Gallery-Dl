const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'TweetData', 'Threads');

function formatDate(twitterDateStr) {
    try {
        const dt = new Date(twitterDateStr);
        if (isNaN(dt.getTime())) return twitterDateStr;
        return dt.toLocaleString('en-US', {
            hour: 'numeric', minute: 'numeric', hour12: true,
            month: 'short', day: 'numeric', year: 'numeric'
        });
    } catch (e) {
        return twitterDateStr;
    }
}

function processResult(result, threadId) {
    if (!result) return null;
    if (result.tweet) result = result.tweet;

    const legacy = result.legacy;
    const userRes = result.core?.user_results?.result;

    if (!legacy || !userRes) return null;

    const userCore = userRes.core || {};
    const userAvatar = userRes.avatar || {};
    const userLegacy = userRes.legacy || {};
    
    // focal tweet's author rest_id to filter out random comments
    const authorId = userRes.rest_id || "";

    const threadMediaDir = path.join(ROOT_DIR, 'TweetData', 'ThreadMedia', threadId || '');
    function getBase64Image(filename, originalUrl) {
        if (!threadId) return originalUrl;
        const localPath = path.join(threadMediaDir, filename);
        if (fs.existsSync(localPath)) {
            try {
                const ext = path.extname(filename).toLowerCase().substring(1) || 'jpeg';
                const b64 = fs.readFileSync(localPath, 'base64');
                return `data:image/${ext};base64,${b64}`;
            } catch(e) {}
        }
        return originalUrl;
    }

    const name = userCore.name || userLegacy.name || "Unknown";
    const handle = userCore.screen_name || userLegacy.screen_name || "unknown";
    const rawAvatar = userAvatar.image_url || userLegacy.profile_image_url_https || "";
    const avatarName = authorId ? `avatar_${authorId}.jpg` : null;
    const avatar = avatarName ? getBase64Image(avatarName, rawAvatar) : rawAvatar;

    let mediaHtml = "";
    const mediaItems = legacy.extended_entities?.media || [];
    if (mediaItems.length > 0) {
        const gridClass = `media-container media-container-${Math.min(mediaItems.length, 4)}`;
        mediaHtml += `<div class='${gridClass}'>`;
        for (const m of mediaItems) {
            if (m.type === "photo") {
                const filename = path.basename(new URL(m.media_url_https).pathname);
                let b64Str = "";
                const localPath = path.join(threadMediaDir, filename);
                if (fs.existsSync(localPath)) {
                    try {
                        const ext = path.extname(filename).toLowerCase().substring(1) || 'jpeg';
                        const b64 = fs.readFileSync(localPath, 'base64');
                        b64Str = `data:image/${ext};base64,${b64}`;
                    } catch(e) {}
                }
                const localRelPath = `../ThreadMedia/${threadId}/${filename}`;
                mediaHtml += `<div class="media-item"><img src="${m.media_url_https}" data-base64="${b64Str}" data-local="${localRelPath}" onerror="onImgError(this)" alt="Tweet Image"></div>`;
            } else if (m.type === "video" || m.type === "animated_gif") {
                const variants = m.video_info?.variants || [];
                const mp4s = variants.filter(v => v.content_type === "video/mp4");
                if (mp4s.length > 0) {
                    const bestMp4 = mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
                    const filename = path.basename(new URL(bestMp4.url).pathname);
                    const localRelPath = `../ThreadMedia/${threadId}/${filename}`;
                    mediaHtml += `<div class="media-item"><video controls autoplay loop muted><source src="${bestMp4.url}" type="video/mp4"><source src="${localRelPath}" type="video/mp4"></video></div>`;
                }
            }
        }
        mediaHtml += "</div>";
    }

    const text = legacy.full_text || "";

    return {
        authorId,
        inReplyTo: legacy.in_reply_to_user_id_str || "",
        name,
        handle: `@${handle}`,
        avatar,
        text,
        date: formatDate(legacy.created_at),
        mediaHtml
    };
}

function extractTweets(data, threadId) {
    const allParsedTweets = [];

    for (const entry of data) {
        const entryId = entry.entryId || "";
        if (entryId.startsWith("tweet-")) {
            const res = entry.content?.itemContent?.tweet_results?.result;
            const t = processResult(res, threadId);
            if (t) allParsedTweets.push(t);
        } else if (entryId.startsWith("conversationthread-")) {
            const items = entry.content?.items || [];
            for (const item of items) {
                const res = item.item?.itemContent?.tweet_results?.result;
                const t = processResult(res, threadId);
                if (t) allParsedTweets.push(t);
            }
        }
    }

    if (allParsedTweets.length === 0) return [];

    // Filter by original author ID and ensure it's part of the main thread (replying to themselves or root)
    const focalAuthorId = allParsedTweets[0].authorId;
    return allParsedTweets.filter(t => t.authorId === focalAuthorId && (t.inReplyTo === focalAuthorId || t.inReplyTo === ""));
}

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Twitter Thread</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap" rel="stylesheet">
<style>
    body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background-color: #000000;
        color: #e7e9ea;
        margin: 0;
        padding: 40px 20px;
        display: flex;
        justify-content: center;
        -webkit-font-smoothing: antialiased;
    }
    .thread-container {
        max-width: 600px;
        width: 100%;
    }
    .tweet {
        display: flex;
        padding: 15px 0;
        position: relative;
    }
    /* Thread connecting line */
    .tweet:not(:last-child)::after {
        content: '';
        position: absolute;
        left: 24px;
        top: 65px;
        bottom: -15px;
        width: 2px;
        background-color: #38444d;
    }
    .avatar-col {
        margin-right: 15px;
        z-index: 1;
    }
    .avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background-color: #2f3336;
        object-fit: cover;
    }
    .content-col {
        flex: 1;
        min-width: 0;
    }
    .header {
        display: flex;
        align-items: center;
        margin-bottom: 5px;
        flex-wrap: wrap;
    }
    .name {
        font-weight: 700;
        margin-right: 5px;
        color: #f9f9f9;
    }
    .handle, .date {
        color: #8b98a5;
        font-size: 0.95em;
    }
    .dot {
        color: #8b98a5;
        margin: 0 5px;
    }
    .text {
        font-size: 15px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        margin-bottom: 12px;
        color: #e1e8ed;
    }
    .text a {
        color: #1da1f2;
        text-decoration: none;
    }
    .text a:hover {
        text-decoration: underline;
    }
    .media-container {
        margin-top: 12px;
        border-radius: 16px;
        overflow: hidden;
        border: 1px solid #38444d;
        display: grid;
        gap: 2px;
    }
    .media-container-1 {
        display: inline-flex; /* Shrink to fit the image */
        max-width: 100%;
    }
    .media-container-1 img, .media-container-1 video {
        width: auto !important;
        height: auto !important;
        max-height: 550px;
        max-width: 100%;
        object-fit: contain !important;
    }
    .media-container-2 {
        grid-template-columns: 1fr 1fr;
        aspect-ratio: 16/9;
    }
    .media-container-3 {
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1fr 1fr;
        aspect-ratio: 16/9;
    }
    .media-container-3 .media-item:first-child {
        grid-row: 1 / 3;
    }
    .media-container-4 {
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1fr 1fr;
        aspect-ratio: 16/9;
    }
    .media-item {
        width: 100%;
        height: 100%;
        overflow: hidden;
        display: flex; /* Centers media perfectly in grid cells */
        align-items: center;
        justify-content: center;
    }
    .media-container img, .media-container video {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
    }
</style>
</head>
<body>
<div class="thread-container">
{tweets_html}
</div>
</body>
</html>`;

const TWEET_TEMPLATE = `
    <div class="tweet">
        <div class="avatar-col">
            <img src="{avatar}" class="avatar" alt="Profile Picture">
        </div>
        <div class="content-col">
            <div class="header">
                <span class="name">{name}</span>
                <span class="handle">{handle}</span>
                <span class="dot">·</span>
                <span class="date">{date}</span>
            </div>
            <div class="text">{text}</div>
            {media_html}
        </div>
    </div>
`;

function generateHtml(tweets) {
    let tweetsHtml = "";
    for (const t of tweets) {
        let snippet = TWEET_TEMPLATE;
        snippet = snippet.replace("{avatar}", t.avatar);
        snippet = snippet.replace("{name}", t.name);
        snippet = snippet.replace("{handle}", t.handle);
        snippet = snippet.replace("{date}", t.date);
        snippet = snippet.replace("{text}", t.text);
        snippet = snippet.replace("{media_html}", t.mediaHtml);
        tweetsHtml += snippet;
    }
    return HTML_TEMPLATE.replace("{tweets_html}", tweetsHtml);
}

function processFile(jsonPath) {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    const threadId = path.basename(jsonPath, '.json').replace('_thread', '');
    const tweets = extractTweets(data, threadId);

    if (tweets.length === 0) {
        console.log(`No valid tweets found in ${path.basename(jsonPath)}.`);
        return;
    }

    const htmlContent = generateHtml(tweets);
    
    const baseName = path.basename(jsonPath).replace(".json", ".html");
    const outPath = path.join(OUTPUT_DIR, baseName);
    
    fs.writeFileSync(outPath, htmlContent, "utf-8");
    console.log(`Successfully generated Threader HTML for ${baseName} (${tweets.length} tweets).`);
}

function main() {
    const inputPath = process.argv[2];
    if (!inputPath) {
        console.error("Usage: node generate_html.js <path_to_json_file_or_directory>");
        process.exit(1);
    }

    if (!fs.existsSync(inputPath)) {
        console.error(`Error: Path not found ${inputPath}`);
        process.exit(1);
    }

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const stats = fs.statSync(inputPath);
    if (stats.isDirectory()) {
        const files = fs.readdirSync(inputPath).filter(f => f.endsWith('.json'));
        console.log(`Found ${files.length} JSON files in directory. Processing...`);
        for (const file of files) {
            processFile(path.join(inputPath, file));
        }
    } else {
        processFile(inputPath);
    }
    console.log(`All HTML files saved to: ${OUTPUT_DIR}`);
}

main();
