function parseRecord(record) {
    const parsed = {
        isLegacy: false,
        isMedia: false,
        tweetId: null,
        mediaUrl: null,
        type: null,
        duration: null,
        date: null,
        convoId: null,
        retweetId: null,
        authorName: null,
        dataObj: null
    };

    if (Array.isArray(record)) {
        if (record[0] === 2) {
            parsed.isLegacy = true;
            parsed.dataObj = record[1] || {};
            parsed.tweetId = parsed.dataObj.tweet_id || parsed.dataObj.id_str || null;
            parsed.convoId = parsed.dataObj.conversation_id || null;
            parsed.retweetId = parsed.dataObj.retweet_id !== undefined ? parsed.dataObj.retweet_id : null;
            parsed.authorName = parsed.dataObj.author ? parsed.dataObj.author.name : null;
            parsed.date = parsed.dataObj.date || null;
        } else if (record[0] === 3) {
            parsed.isMedia = true;
            parsed.mediaUrl = record[1] || null;
            parsed.dataObj = record[2] || {};
            parsed.tweetId = parsed.dataObj.tweet_id || parsed.dataObj.id_str || null;
            parsed.type = parsed.dataObj.type || null;
            parsed.duration = parsed.dataObj.duration || null;
            parsed.date = parsed.dataObj.date || null;
            parsed.convoId = parsed.dataObj.conversation_id || null;
        } else {
            parsed.dataObj = record;
        }
    } else if (record && typeof record === 'object') {
        parsed.tweetId = record.tweet_id || record.id_str || null;
        parsed.mediaUrl = record.url || record.media_url_https || record.media_url || null;
        parsed.type = record.type || null;
        parsed.duration = record.duration || null;
        parsed.date = record.date || record.created_at || null;
        parsed.convoId = record.conversation_id || null;
        parsed.retweetId = record.retweet_id !== undefined ? record.retweet_id : null;
        parsed.authorName = record.author ? record.author.name : null;
        
        if (parsed.tweetId && !parsed.mediaUrl) {
            parsed.isLegacy = true;
        } else if (parsed.mediaUrl) {
            parsed.isMedia = true;
        }
        
        if (!parsed.type && parsed.mediaUrl) {
            if (parsed.mediaUrl.includes('.mp4') || parsed.mediaUrl.includes('video.twimg.com')) {
                parsed.type = 'video';
            } else {
                parsed.type = 'photo';
            }
        }
        parsed.dataObj = record;
    }

    return parsed;
}

function getRecordKey(record) {
    const parsed = parseRecord(record);
    if (parsed.isLegacy && parsed.tweetId) {
        return '2_' + parsed.tweetId;
    } else if (parsed.isMedia && parsed.mediaUrl) {
        return '3_' + parsed.mediaUrl;
    } else {
        return JSON.stringify(record);
    }
}

module.exports = {
    parseRecord,
    getRecordKey
};
