const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const RAW_DIR = path.join(ROOT_DIR, 'TweetData', 'ThreadsRaw');
const MEDIA_DIR = path.join(ROOT_DIR, 'TweetData', 'ThreadMedia');

const jsons = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('_thread.json'));
const mismatchedThreads = [];

for (const jsonFile of jsons) {
    const threadId = jsonFile.replace('_thread.json', '');
    const jsonPath = path.join(RAW_DIR, jsonFile);
    
    let rawData;
    try {
        rawData = fs.readFileSync(jsonPath, 'utf8');
    } catch(e) { continue; }
    
    // Quick regex to find all media urls
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
