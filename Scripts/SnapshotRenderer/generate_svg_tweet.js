const fs = require('fs');
const path = require('path');
const { parseRecord } = require('../lib/recordSchema');
const { ROOT_DIR, TWEET_DATA_DIR, RAW_DATA_DIR } = require('../lib/paths');
const { buildPerfectTweetSvg, calculateLayout } = require('./perfect_single_tweet_svg');

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'tweet_template.svg');
const OUTPUT_DIR = path.join(TWEET_DATA_DIR, 'TimeLineOutput', 'svg');

/**
 * Normalizes raw tweet records (both raw API objects and gallery-dl tuple arrays)
 */
function extractTweetFields(record) {
    const parsed = parseRecord(record);
    const data = parsed.dataObj || {};
    const author = data.author || data.user || {};

    const displayName = author.nick || author.name || data.author_name || 'Anonymous User';
    const handle = author.name ? (author.name.startsWith('@') ? author.name : `@${author.name}`) : '@user';
    const avatarUrl = author.profile_image || author.profile_image_url_https || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';
    const tweetText = data.content || data.full_text || data.text || '';
    const date = data.date || data.created_at || 'Aug 11, 2026';
    const verified = author.verified || false;

    let mediaUrl = parsed.mediaUrl || '';
    if (!mediaUrl && data.extended_entities && data.extended_entities.media && data.extended_entities.media.length > 0) {
        mediaUrl = data.extended_entities.media[0].media_url_https || '';
    }

    return {
        tweetId: parsed.tweetId || String(Date.now()),
        displayName,
        handle,
        avatarUrl,
        tweetText,
        mediaUrl,
        date,
        verified,
        likes: data.favorite_count || 0,
        reposts: data.retweet_count || 0,
        replies: data.reply_count || 0,
        views: data.view_count || data.impression_count || 0
    };
}

/**
 * Renders a perfected, dynamic SVG string
 */
async function renderTweetSvg(data = {}) {
    const fields = data.tweetId ? data : extractTweetFields(data);
    return await buildPerfectTweetSvg(fields);
}

/**
 * Bulk process a raw JSON file containing real tweet records into SVG output files
 */
async function bulkProcessJson(jsonFilePath, outputSubDir = '') {
    if (!fs.existsSync(jsonFilePath)) {
        throw new Error(`Input file not found: ${jsonFilePath}`);
    }

    const targetFolder = outputSubDir ? path.join(OUTPUT_DIR, outputSubDir) : OUTPUT_DIR;
    if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true });
    }

    const rawData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));

    const items = Array.isArray(rawData) ? rawData : [rawData];
    console.log(`[Bulk SVG Processor] Processing ${items.length} records from ${path.basename(jsonFilePath)}...`);

    let count = 0;
    const generatedFiles = [];
    const seenIds = new Set();

    for (let i = 0; i < items.length; i++) {
        const fields = extractTweetFields(items[i]);
        if (!fields.tweetText && !fields.mediaUrl) continue;
        if (seenIds.has(fields.tweetId)) continue;
        seenIds.add(fields.tweetId);

        const svgContent = await renderTweetSvg(fields);
        const outPath = path.join(targetFolder, `tweet_${fields.tweetId}.svg`);
        fs.writeFileSync(outPath, svgContent, 'utf8');
        generatedFiles.push(outPath);
        count++;

        if (count >= 50) break;
    }

    console.log(`[Bulk SVG Processor] Successfully generated ${count} SVG files in ${targetFolder}`);
    return generatedFiles;
}

module.exports = {
    renderTweetSvg,
    extractTweetFields,
    bulkProcessJson
};
