const fs = require('fs');
const path = require('path');
const { downloadWithRetry, getBulkDownloadUrl, constructFilename } = require('./download');
const { THREADS_MEDIA_DIR } = require('./paths');

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

async function processThreadMedia(jsonFile, targetMediaDir = THREADS_MEDIA_DIR) {
    const threadId = path.basename(jsonFile, '_thread.json');
    const threadMediaDir = path.join(targetMediaDir, threadId);
    if (!fs.existsSync(threadMediaDir)) {
        fs.mkdirSync(threadMediaDir, { recursive: true });
    }

    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
    console.log(`[Media] Downloading media items for thread ${threadId}...`);

    for (const entry of data) {
        let result = null;
        if (entry.entryId && entry.entryId.startsWith('tweet-')) {
            result = entry.content?.itemContent?.tweet_results?.result;
        } else if (entry.entryId && entry.entryId.startsWith('conversationthread-')) {
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

module.exports = {
    downloadFile,
    handleMediaItem,
    processThreadMedia
};
