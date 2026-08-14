const fs = require('fs');
const path = require('path');
const { parseRecord } = require('./recordSchema');

function calculateUntilDateFromFile(filePath) {
    if (!fs.existsSync(filePath)) return null;

    let records;
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        records = JSON.parse(raw);
    } catch (e) {
        return null;
    }

    if (!Array.isArray(records) || records.length === 0) return null;

    const tweets = [];
    for (const record of records) {
        const parsed = parseRecord(record);
        if (parsed.isLegacy && parsed.date) {
            const dt = new Date(parsed.date);
            if (!isNaN(dt.getTime())) {
                tweets.push({ rawDate: parsed.date, timestamp: dt.getTime(), dateObj: dt });
            }
        }
    }

    if (tweets.length === 0) return null;

    // Scan last ~20 tweets
    const scanCount = Math.min(tweets.length, 20);
    const lastTweets = tweets.slice(tweets.length - scanCount);

    // Sort by date descending
    lastTweets.sort((a, b) => b.timestamp - a.timestamp);

    let oldestTweet = lastTweets[lastTweets.length - 1];

    // Check for pinned tweet gap anomaly (> 30 days gap between consecutive tweets in descending list)
    for (let i = lastTweets.length - 2; i >= 0; i--) {
        const dateA = lastTweets[i].timestamp;
        const dateB = lastTweets[i + 1].timestamp;
        const diffDays = (dateA - dateB) / (1000 * 60 * 60 * 24);
        if (diffDays > 30) {
            oldestTweet = lastTweets[i];
            break;
        }
    }

    // Add 2 day buffer to the anchor date to intentionally overlap with STATE_USER
    const anchorDate = new Date(oldestTweet.timestamp);
    anchorDate.setUTCDate(anchorDate.getUTCDate() + 2);

    const year = anchorDate.getUTCFullYear();
    const month = String(anchorDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(anchorDate.getUTCDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

if (require.main === module) {
    const targetFile = process.argv[2];
    if (targetFile) {
        const result = calculateUntilDateFromFile(targetFile);
        if (result) {
            console.log(result);
        }
    }
}

module.exports = {
    calculateUntilDateFromFile
};
