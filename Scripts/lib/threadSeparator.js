const fs = require('fs');
const path = require('path');
const { RAW_DATA_DIR, RAW_THREADS_DIR } = require('./paths');
const { parseRecord } = require('./recordSchema');

async function runSeparateThreads() {
    console.log('\n==================================================');
    console.log('          X/Twitter Thread Separator');
    console.log(` Raw Data Directory : ${RAW_DATA_DIR}`);
    console.log(` Output Directory   : ${RAW_THREADS_DIR}`);
    console.log('==================================================\n');

    if (!fs.existsSync(RAW_DATA_DIR)) {
        console.error(`Directory not found: ${RAW_DATA_DIR}`);
        return;
    }
    if (!fs.existsSync(RAW_THREADS_DIR)) fs.mkdirSync(RAW_THREADS_DIR, { recursive: true });

    const files = fs.readdirSync(RAW_DATA_DIR).filter(f => f.endsWith('.json'));
    console.log(`Found ${files.length} JSON files to process for threads...`);

    let totalThreadsMoved = 0, totalFilesModified = 0;

    for (const file of files) {
        const filePath = path.join(RAW_DATA_DIR, file);
        const threadFilePath = path.join(RAW_THREADS_DIR, file);

        let dataRaw = fs.readFileSync(filePath, 'utf8');
        let records = JSON.parse(dataRaw);
        if (!Array.isArray(records)) continue;

        const convoMap = new Map();
        for (const record of records) {
            const parsed = parseRecord(record);
            if (parsed.convoId && parsed.tweetId) {
                if (!convoMap.has(parsed.convoId)) convoMap.set(parsed.convoId, new Set());
                convoMap.get(parsed.convoId).add(parsed.tweetId);
            }
        }

        const threadConvoIds = new Set();
        for (const [convoId, tweetIds] of convoMap.entries()) {
            if (tweetIds.size > 1) threadConvoIds.add(convoId);
        }

        if (threadConvoIds.size === 0) continue;

        const standaloneRecords = [], threadRecords = [];
        for (const record of records) {
            const parsed = parseRecord(record);
            if (parsed.convoId && threadConvoIds.has(parsed.convoId)) {
                threadRecords.push(record);
            } else {
                standaloneRecords.push(record);
            }
        }

        if (threadRecords.length > 0) {
            totalThreadsMoved += threadConvoIds.size;
            totalFilesModified++;

            let existingThreadRecords = [];
            if (fs.existsSync(threadFilePath)) {
                try {
                    existingThreadRecords = JSON.parse(fs.readFileSync(threadFilePath, 'utf8'));
                } catch(e) {}
            }

            const combinedThreads = [...existingThreadRecords, ...threadRecords];
            fs.writeFileSync(threadFilePath, JSON.stringify(combinedThreads, null, 2));
            fs.writeFileSync(filePath, JSON.stringify(standaloneRecords, null, 2));

            console.log(`[${file}] Moved ${threadConvoIds.size} threads (${threadRecords.length} records) to RawThreads.`);
        }
    }

    console.log(`\nFinished! Separated ${totalThreadsMoved} threads across ${totalFilesModified} files.`);
}

module.exports = { runSeparateThreads };
