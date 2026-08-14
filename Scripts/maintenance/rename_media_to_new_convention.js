#!/usr/bin/env node
/**
 * Maintenance Script: Rename Existing Media Files to New Naming Convention
 * ========================================================================
 * Converts existing files in TweetData/Media/<account>/ from:
 *   YYYY_MM_DD_tweetId_base.ext  (or similar old formats)
 * To:
 *   YYYY-MM-DD_HH-MM-SS_@account_tweetId_base.ext
 *
 * Updates both local filenames on disk and mapping files under TweetData/Media/Mappings/
 */

const fs = require('fs');
const path = require('path');
const { parseRecord } = require('../lib/recordSchema');
const { constructFilename, getBulkDownloadUrl } = require('../lib/download');
const { MEDIA_DIR, RAW_DATA_DIR, NEW_RAW_DATA_DIR } = require('../lib/paths');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

const MAPPING_DIR = path.join(MEDIA_DIR, 'Mappings');

function findRawJsonForAccount(accountName) {
    const candidates = [
        path.join(NEW_RAW_DATA_DIR, `${accountName}_tweets.json`),
        path.join(NEW_RAW_DATA_DIR, `${accountName}.json`),
        path.join(RAW_DATA_DIR, `${accountName}_tweets.json`),
        path.join(RAW_DATA_DIR, `${accountName}.json`),
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

async function renameAccountMedia(accountName) {
    const accountMediaDir = path.join(MEDIA_DIR, accountName);
    if (!fs.existsSync(accountMediaDir) || !fs.statSync(accountMediaDir).isDirectory()) {
        return;
    }

    const rawJsonPath = findRawJsonForAccount(accountName);
    if (!rawJsonPath) {
        console.warn(`[Skip] No raw JSON found for account '@${accountName}'`);
        return;
    }

    console.log(`\nProcessing account '@${accountName}' using JSON: ${path.basename(rawJsonPath)}`);

    let records = [];
    try {
        records = JSON.parse(fs.readFileSync(rawJsonPath, 'utf8'));
    } catch (err) {
        console.error(`Error reading ${rawJsonPath}:`, err.message);
        return;
    }

    // Build lookup maps by (mediaUrl) and by (tweetId + baseName)
    const urlMap = new Map();
    const keyMap = new Map();

    for (const record of records) {
        const parsed = parseRecord(record);
        if (!parsed.isMedia || !parsed.mediaUrl) continue;

        const mediaUrl = getBulkDownloadUrl(parsed.mediaUrl);
        const cleanUrl = mediaUrl.split('?')[0];
        const ext = path.extname(cleanUrl) || '.jpg';
        const base = path.basename(cleanUrl, ext);
        const tweetId = parsed.tweetId || '';
        const dateStr = parsed.date || '';

        const cleanAccountName = accountName.replace(/_tweets$/i, '').replace(/^@/, '');
        const newName = constructFilename(mediaUrl, tweetId, dateStr, cleanAccountName);

        const info = { mediaUrl, tweetId, dateStr, base, ext, newName };
        urlMap.set(mediaUrl, info);

        if (tweetId && base) {
            keyMap.set(`${tweetId}_${base}${ext}`, info);
            keyMap.set(`${base}${ext}`, info);
        }
    }

    const localFiles = fs.readdirSync(accountMediaDir);
    let renamedCount = 0;
    let unchangedCount = 0;

    // Load existing mapping if available
    const mappingFilePath = path.join(MAPPING_DIR, `${accountName}_media_map.json`);
    let mapping = {};
    if (fs.existsSync(mappingFilePath)) {
        try {
            mapping = JSON.parse(fs.readFileSync(mappingFilePath, 'utf8'));
        } catch (e) {
            mapping = {};
        }
    }
    const newMapping = {};

    for (const file of localFiles) {
        const oldPath = path.join(accountMediaDir, file);
        if (fs.statSync(oldPath).isDirectory()) continue;

        const ext = path.extname(file);
        const cleanExt = ext.split('?')[0];

        // Match against keyMap or find by base name & tweetId pattern
        let info = null;
        for (const [key, val] of keyMap.entries()) {
            if (file.endsWith(key) || file.includes(val.base)) {
                info = val;
                break;
            }
        }

        if (!info) {
            // Keep unchanged if no metadata match
            unchangedCount++;
            continue;
        }

        const targetName = info.newName;
        if (file === targetName) {
            unchangedCount++;
            newMapping[info.mediaUrl] = `${accountName}/${targetName}`;
            continue;
        }

        const newPath = path.join(accountMediaDir, targetName);

        if (DRY_RUN) {
            console.log(`  [DRY-RUN] Would rename: ${file} -> ${targetName}`);
        } else {
            try {
                fs.renameSync(oldPath, newPath);
                console.log(`  [RENAMED] ${file} -> ${targetName}`);
                renamedCount++;
            } catch (err) {
                console.error(`  [ERROR] Renaming ${file}:`, err.message);
            }
        }

        newMapping[info.mediaUrl] = `${accountName}/${targetName}`;
    }

    if (!DRY_RUN && renamedCount > 0) {
        // Merge remaining mappings
        for (const [k, v] of Object.entries(mapping)) {
            if (!newMapping[k]) newMapping[k] = v;
        }
        if (!fs.existsSync(MAPPING_DIR)) fs.mkdirSync(MAPPING_DIR, { recursive: true });
        fs.writeFileSync(mappingFilePath, JSON.stringify(newMapping, null, 2), 'utf8');
        console.log(`Updated mapping file: ${path.basename(mappingFilePath)}`);
    }

    console.log(`Account '@${accountName}' Summary: ${renamedCount} renamed, ${unchangedCount} unchanged.`);
}

async function main() {
    console.log("=== Media Naming Migration Tool ===");
    if (DRY_RUN) console.log("--- RUNNING IN DRY-RUN MODE (No files will be modified) ---\n");

    if (!fs.existsSync(MEDIA_DIR)) {
        console.log(`Media directory '${MEDIA_DIR}' does not exist.`);
        return;
    }

    const items = fs.readdirSync(MEDIA_DIR);
    const accounts = items.filter(item => {
        const itemPath = path.join(MEDIA_DIR, item);
        return fs.statSync(itemPath).isDirectory() && item !== 'Mappings';
    });

    if (accounts.length === 0) {
        console.log("No account media directories found.");
        return;
    }

    console.log(`Found ${accounts.length} account directories: ${accounts.join(', ')}`);
    for (const acc of accounts) {
        await renameAccountMedia(acc);
    }

    console.log("\nMigration completed successfully!");
}

main().catch(err => {
    console.error("Fatal Error:", err);
});
