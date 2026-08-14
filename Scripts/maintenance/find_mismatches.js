const fs = require('fs');
const path = require('path');
const { THREADS_RAW_DIR, THREADS_MEDIA_DIR } = require('../lib/paths');

if (!fs.existsSync(THREADS_RAW_DIR)) {
    console.log(`ThreadsRaw directory (${THREADS_RAW_DIR}) does not exist.`);
    process.exit(0);
}

const jsons = fs.readdirSync(THREADS_RAW_DIR).filter(f => f.endsWith('_thread.json'));
const mismatchedThreads = [];

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
        mismatchedThreads.push(threadId);
        console.log(`Mismatch in thread: ${threadId}`);
        for (const jsonMedia of jsonMediaFiles) {
            if (!localMediaFiles.has(jsonMedia)) {
                console.log(`  Missing local file for JSON url: ${jsonMedia}`);
            }
        }
    }
}

console.log(`Found ${mismatchedThreads.length} threads with mismatches.`);
