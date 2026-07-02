const fs = require('fs');
const path = require('path');
const { RAW_DATA_DIR, STATS_OUTPUT_PATH } = require('./paths');
const { parseRecord } = require('./recordSchema');

async function runStats(options = { format: 'both' }) {
    console.log('\n==================================================');
    console.log('       X/Twitter Summary Statistics Generator');
    console.log(` Raw Data Directory : ${RAW_DATA_DIR}`);
    console.log(` Output Format      : ${options.format}`);
    console.log(` Output Base Path   : ${STATS_OUTPUT_PATH}`);
    console.log('==================================================\n');

    if (!fs.existsSync(RAW_DATA_DIR)) {
        console.error(`Error: Source directory '${RAW_DATA_DIR}' does not exist.`);
        return;
    }

    const files = fs.readdirSync(RAW_DATA_DIR).filter(file => file.endsWith('.json'));
    if (files.length === 0) {
        console.log('No JSON files found in the source directory.');
        return;
    }

    console.log(`Analyzing ${files.length} files...`);

    const statsList = [];
    let grandTotalRecords = 0, grandTotalTweets = 0, grandTotalRetweets = 0, grandTotalVideos = 0, grandTotalImages = 0;

    for (const file of files) {
        const filePath = path.join(RAW_DATA_DIR, file);
        const accountName = file.replace(/_tweets\.json$|\.json$/i, '');

        let dataRaw;
        try {
            dataRaw = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
            console.error(`[Error] Failed to read ${file}: ${err.message}`);
            continue;
        }

        let records;
        try {
            records = JSON.parse(dataRaw);
        } catch (err) {
            console.error(`[Error] Failed to parse JSON in ${file}: ${err.message}`);
            continue;
        }

        if (!Array.isArray(records)) continue;

        let tweetsCount = 0, retweetsCount = 0, videosCount = 0, imagesCount = 0;

        for (const record of records) {
            const parsed = parseRecord(record);

            if (parsed.isLegacy) {
                tweetsCount++;
                if (parsed.retweetId && parsed.retweetId !== 0) {
                    retweetsCount++;
                }
            }

            if (parsed.isMedia) {
                if (parsed.type === 'video' || parsed.type === 'animated_gif') {
                    videosCount++;
                } else if (parsed.type === 'photo') {
                    imagesCount++;
                }
            }
        }

        const originalCount = tweetsCount - retweetsCount;
        statsList.push({
            account: accountName,
            totalRecords: records.length,
            totalTweets: tweetsCount,
            original: originalCount,
            retweets: retweetsCount,
            videos: videosCount,
            images: imagesCount
        });

        grandTotalRecords += records.length;
        grandTotalTweets += tweetsCount;
        grandTotalRetweets += retweetsCount;
        grandTotalVideos += videosCount;
        grandTotalImages += imagesCount;
    }

    statsList.sort((a, b) => b.totalRecords - a.totalRecords);

    // Save CSV
    if (options.format === 'csv' || options.format === 'both') {
        const csvPath = `${STATS_OUTPUT_PATH}.csv`;
        let csvContent = "Account,Total Records,Total Tweets,Original Tweets,Retweets,Videos,Images\n";
        statsList.forEach(s => {
            csvContent += `${s.account},${s.totalRecords},${s.totalTweets},${s.original},${s.retweets},${s.videos},${s.images}\n`;
        });
        csvContent += `GRAND TOTAL,${grandTotalRecords},${grandTotalTweets},${grandTotalTweets - grandTotalRetweets},${grandTotalRetweets},${grandTotalVideos},${grandTotalImages}\n`;
        fs.writeFileSync(csvPath, csvContent, 'utf8');
        console.log(`CSV report successfully saved to: ${csvPath}`);
    }

    // Save Markdown
    if (options.format === 'md' || options.format === 'both') {
        const mdPath = `${STATS_OUTPUT_PATH}.md`;
        let mdContent = `# X/Twitter Scraped Accounts Statistics\n\n`;
        mdContent += `*Report Generated: ${new Date().toLocaleString()}*\n\n`;
        mdContent += `## Grand Totals Summary\n\n`;
        mdContent += `| Metric | Count |\n| --- | --- |\n`;
        mdContent += `| **Total Records** | ${grandTotalRecords.toLocaleString()} |\n`;
        mdContent += `| **Total Tweets** | ${grandTotalTweets.toLocaleString()} |\n`;
        mdContent += `| **Original Tweets** | ${(grandTotalTweets - grandTotalRetweets).toLocaleString()} |\n`;
        mdContent += `| **Retweets** | ${grandTotalRetweets.toLocaleString()} |\n`;
        mdContent += `| **Videos** | ${grandTotalVideos.toLocaleString()} |\n`;
        mdContent += `| **Images** | ${grandTotalImages.toLocaleString()} |\n\n`;

        mdContent += `## Account Detailed Statistics\n\n`;
        mdContent += `| Account | Total Records | Total Tweets | Original Tweets | Retweets | Videos | Images |\n`;
        mdContent += `| --- | --- | --- | --- | --- | --- | --- |\n`;
        statsList.forEach(s => {
            mdContent += `| **${s.account}** | ${s.totalRecords.toLocaleString()} | ${s.totalTweets.toLocaleString()} | ${s.original.toLocaleString()} | ${s.retweets.toLocaleString()} | ${s.videos.toLocaleString()} | ${s.images.toLocaleString()} |\n`;
        });
        fs.writeFileSync(mdPath, mdContent, 'utf8');
        console.log(`Markdown report successfully saved to: ${mdPath}`);
    }

    console.log('\n==================================================');
    console.log('                Execution Summary');
    console.log(` Handles Processed : ${files.length}`);
    console.log(` Total Tweets      : ${grandTotalTweets} (${grandTotalRetweets} Retweets, ${grandTotalTweets - grandTotalRetweets} Original)`);
    console.log(` Total Videos      : ${grandTotalVideos}`);
    console.log(` Total Images      : ${grandTotalImages}`);
    console.log('==================================================');
}

module.exports = { runStats };
