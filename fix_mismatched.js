const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { downloadWithRetry, getBulkDownloadUrl } = require('./Scripts/lib/download');

const ROOT_DIR = __dirname;
const RAW_DIR = path.join(ROOT_DIR, 'TweetData', 'ThreadsRaw');
const THREADS_DIR = path.join(ROOT_DIR, 'TweetData', 'Threads');
const MEDIA_DIR = path.join(ROOT_DIR, 'TweetData', 'ThreadMedia');

const MISMATCH_DIR = path.join(ROOT_DIR, 'TweetData', 'MismatchedThreads');
const MISMATCH_RAW_DIR = path.join(MISMATCH_DIR, 'ThreadsRaw');
const MISMATCH_THREADS_DIR = path.join(MISMATCH_DIR, 'Threads');
const MISMATCH_MEDIA_DIR = path.join(MISMATCH_DIR, 'ThreadMedia');

[MISMATCH_DIR, MISMATCH_RAW_DIR, MISMATCH_THREADS_DIR, MISMATCH_MEDIA_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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
    const threadMediaDir = path.join(MEDIA_DIR, threadId);
    if (!fs.existsSync(threadMediaDir)) {
        fs.mkdirSync(threadMediaDir, { recursive: true });
    }

    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));

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

async function main() {
    const jsons = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('_thread.json'));
    let processedCount = 0;

    for (const jsonFile of jsons) {
        const threadId = jsonFile.replace('_thread.json', '');
        const jsonPath = path.join(RAW_DIR, jsonFile);
        
        let rawData;
        try {
            rawData = fs.readFileSync(jsonPath, 'utf8');
        } catch(e) { continue; }
        
        const matches = rawData.match(/https:\/\/pbs\.twimg\.com\/media\/([A-Za-z0-9_-]+\.(?:jpg|png|mp4))/g) || [];
        const jsonMediaFiles = new Set(matches.map(url => path.basename(new URL(url).pathname)));
        
        const threadMediaDir = path.join(MEDIA_DIR, threadId);
        let localMediaFiles = new Set();
        if (fs.existsSync(threadMediaDir)) {
            localMediaFiles = new Set(fs.readdirSync(threadMediaDir));
        }
        
        let isMismatch = false;
        for (const jsonMedia of jsonMediaFiles) {
            if (!localMediaFiles.has(jsonMedia)) {
                isMismatch = true;
                break;
            }
        }
        
        if (isMismatch) {
            console.log(`Processing mismatched thread: ${threadId}`);
            
            // 1. Download missing media directly
            try {
                console.log(`  Downloading missing media...`);
                await processThreadMedia(jsonPath);
            } catch (e) {
                console.error(`  Error downloading media for ${threadId}:`, e.message);
                continue;
            }
            
            // 2. Generate HTML
            try {
                console.log(`  Generating HTML...`);
                execSync(`node Scripts/generate_html.js ${jsonPath}`, { stdio: 'inherit' });
            } catch (e) {
                console.error(`  Error generating HTML for ${threadId}:`, e.message);
                continue;
            }
            
            // 3. Move the files to the MismatchedThreads directory
            try {
                const htmlPath = path.join(THREADS_DIR, `${threadId}_thread.html`);
                const targetHtmlPath = path.join(MISMATCH_THREADS_DIR, `${threadId}_thread.html`);
                if (fs.existsSync(htmlPath)) fs.renameSync(htmlPath, targetHtmlPath);
                
                const targetJsonPath = path.join(MISMATCH_RAW_DIR, `${threadId}_thread.json`);
                if (fs.existsSync(jsonPath)) fs.renameSync(jsonPath, targetJsonPath);
                
                const targetMediaDir = path.join(MISMATCH_MEDIA_DIR, threadId);
                if (fs.existsSync(threadMediaDir)) fs.renameSync(threadMediaDir, targetMediaDir);
                
                console.log(`  Moved ${threadId} to MismatchedThreads folder.`);
                processedCount++;
            } catch (e) {
                console.error(`  Error moving files for ${threadId}:`, e.message);
            }
        }
    }

    console.log(`Successfully processed and moved ${processedCount} mismatched threads.`);
}

main();
