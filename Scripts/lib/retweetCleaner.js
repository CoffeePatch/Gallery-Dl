const fs = require('fs');
const path = require('path');
const { RAW_DATA_DIR } = require('./paths');
const { parseRecord } = require('./recordSchema');

async function runCleanSelfRetweets() {
    console.log('\n==================================================');
    console.log('       X/Twitter Self-Retweets Cleaner');
    console.log(` Directory : ${RAW_DATA_DIR}`);
    console.log('==================================================\n');

    if (!fs.existsSync(RAW_DATA_DIR)) {
        console.error(`Directory not found: ${RAW_DATA_DIR}`);
        return;
    }

    const files = fs.readdirSync(RAW_DATA_DIR).filter(f => f.endsWith('.json'));
    console.log(`Found ${files.length} JSON files to process.`);

    let totalCleaned = 0;

    for (const file of files) {
        const filePath = path.join(RAW_DATA_DIR, file);
        const accountName = file.replace(/_tweets\.json$/i, '');

        let dataRaw = fs.readFileSync(filePath, 'utf8');
        let records = JSON.parse(dataRaw);
        if (!Array.isArray(records)) continue;

        const initialLength = records.length;

        const cleanedRecords = records.filter(record => {
            const parsed = parseRecord(record);
            if (parsed.isLegacy) {
                if (parsed.retweetId && parsed.retweetId !== 0) {
                    if (parsed.authorName && parsed.authorName.toLowerCase() === accountName.toLowerCase()) {
                        return false; // Filter out self-retweet
                    }
                }
            }
            return true;
        });

        const cleanedCount = initialLength - cleanedRecords.length;
        if (cleanedCount > 0) {
            fs.writeFileSync(filePath, JSON.stringify(cleanedRecords, null, 2), 'utf8');
            console.log(`[${file}] Cleaned ${cleanedCount} self-retweets.`);
            totalCleaned += cleanedCount;
        }
    }

    console.log(`\nFinished! Cleaned a total of ${totalCleaned} self-retweets.`);
}

module.exports = { runCleanSelfRetweets };
