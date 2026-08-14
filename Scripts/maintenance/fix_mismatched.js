const fs = require('fs');
const path = require('path');
const { THREADS_RAW_DIR, THREADS_MEDIA_DIR, THREADS_OUTPUT_DIR } = require('../lib/paths');
const { processThreadMedia } = require('../lib/mediaDownloader');

const MISMATCH_DIR = path.join(path.dirname(THREADS_RAW_DIR), 'MismatchedThreads');
const MISMATCH_RAW_DIR = path.join(MISMATCH_DIR, 'ThreadsRaw');
const MISMATCH_THREADS_DIR = path.join(MISMATCH_DIR, 'Threads');
const MISMATCH_MEDIA_DIR = path.join(MISMATCH_DIR, 'ThreadMedia');

[MISMATCH_DIR, MISMATCH_RAW_DIR, MISMATCH_THREADS_DIR, MISMATCH_MEDIA_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

async function main() {
    if (!fs.existsSync(THREADS_RAW_DIR)) {
        console.log(`ThreadsRaw directory (${THREADS_RAW_DIR}) does not exist.`);
        return;
    }

    const jsons = fs.readdirSync(THREADS_RAW_DIR).filter(f => f.endsWith('_thread.json'));
    let processedCount = 0;

    for (const jsonFile of jsons) {
        const threadId = jsonFile.replace('_thread.json', '');
        const jsonPath = path.join(THREADS_RAW_DIR, jsonFile);
        
        let rawData;
        try {
            rawData = fs.readFileSync(jsonPath, 'utf8');
        } catch(e) { continue; }
        
        const matches = rawData.match(/https:\/\/pbs\.twimg\.com\/media\/([A-Za-z0-9_-]+\.(?:jpg|png|mp4))/g) || [];
        const jsonMediaFiles = new Set(matches.map(url => path.basename(new URL(url).pathname)));
        
        const threadMediaDir = path.join(THREADS_MEDIA_DIR, threadId);
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
            console.log(`\n[Fixing Mismatch] Thread: ${threadId}`);
            processedCount++;
            await processThreadMedia(jsonPath, THREADS_MEDIA_DIR);
        }
    }

    console.log(`\nDone. Fixed ${processedCount} mismatched threads.`);
}

main().catch(console.error);
