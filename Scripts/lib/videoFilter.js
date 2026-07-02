const fs = require('fs');
const path = require('path');
const { RAW_DATA_DIR, LARGE_VIDEO_DIR } = require('./paths');
const { parseRecord } = require('./recordSchema');

async function runFilterLargeVideos(thresholdSec = 1800) {
    console.log('\n==================================================');
    console.log('       X/Twitter Large Video Data Filter');
    console.log(` Duration Threshold : ${thresholdSec} seconds (${thresholdSec / 60} minutes)`);
    console.log(` Raw Data Directory : ${RAW_DATA_DIR}`);
    console.log(` Output Directory   : ${LARGE_VIDEO_DIR}`);
    console.log('==================================================\n');

    if (!fs.existsSync(RAW_DATA_DIR)) {
        console.error(`Error: Source directory '${RAW_DATA_DIR}' does not exist.`);
        return;
    }
    if (!fs.existsSync(LARGE_VIDEO_DIR)) fs.mkdirSync(LARGE_VIDEO_DIR, { recursive: true });

    const files = fs.readdirSync(RAW_DATA_DIR).filter(file => file.endsWith('.json'));
    if (files.length === 0) {
        console.log('No JSON files found in source directory.');
        return;
    }

    let totalProcessedFiles = 0, totalLargeVideosFound = 0;

    for (const file of files) {
        const filePath = path.join(RAW_DATA_DIR, file);
        const outputFilePath = path.join(LARGE_VIDEO_DIR, file.replace('_tweets.json', '_Large.json'));

        let dataRaw = fs.readFileSync(filePath, 'utf8');
        let records = JSON.parse(dataRaw);
        if (!Array.isArray(records)) continue;

        const filteredVideos = records.filter(record => {
            const parsed = parseRecord(record);
            if (parsed.isMedia && (parsed.type === 'video' || parsed.type === 'animated_gif')) {
                if (parsed.duration !== null && parsed.duration !== undefined) {
                    const durationSec = parseFloat(parsed.duration);
                    return !isNaN(durationSec) && durationSec >= thresholdSec;
                }
            }
            return false;
        });

        if (filteredVideos.length > 0) {
            fs.writeFileSync(outputFilePath, JSON.stringify(filteredVideos, null, 2), 'utf8');
            console.log(`[${file}] Extracted ${filteredVideos.length} large videos to LargeRawData.`);
            totalLargeVideosFound += filteredVideos.length;
            totalProcessedFiles++;
        }
    }

    console.log(`\nFiltered ${totalLargeVideosFound} large videos across ${totalProcessedFiles} files.`);
}

module.exports = { runFilterLargeVideos };
