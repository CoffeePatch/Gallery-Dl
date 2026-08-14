const fs = require('fs');
const path = require('path');
const { mergeStreamsToFile } = require('./streamingMerger');

async function recoverStagingAndBackupFiles(targetFile, store) {
    const candidates = [
        targetFile + '.new_staging.json',
        targetFile + '.backup_new.json'
    ];

    let totalRecovered = 0;

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;

        console.log(`[RECOVERY] Found orphaned recovery file: ${path.basename(candidate)}`);

        // 1. Validate JSON integrity
        let records = null;
        try {
            const raw = fs.readFileSync(candidate, 'utf8');
            records = JSON.parse(raw);
            if (!Array.isArray(records)) {
                throw new Error("Content is not a valid JSON array");
            }
        } catch (err) {
            console.warn(`[RECOVERY WARNING] Corrupted or truncated recovery file detected (${path.basename(candidate)}): ${err.message}. Leaving file intact on disk for manual inspection.`);
            continue;
        }

        if (records.length === 0) {
            console.log(`[RECOVERY] Recovery file ${path.basename(candidate)} is empty. Unlinking.`);
            try { fs.unlinkSync(candidate); } catch (e) {}
            continue;
        }

        // 2. Transactional merge into target
        const tempOutputFile = targetFile + '.recovery_tmp';
        try {
            console.log(`[RECOVERY] Merging ${records.length} records into ${path.basename(targetFile)}...`);
            const stats = await mergeStreamsToFile(
                fs.existsSync(targetFile) ? targetFile : null,
                candidate,
                tempOutputFile
            );

            // Commit merged target file
            fs.renameSync(tempOutputFile, targetFile);

            // 3. Sync SQLite if store is provided
            let syncedCount = 0;
            if (store && typeof store.syncJsonTweets === 'function') {
                syncedCount = store.syncJsonTweets(targetFile);
            }

            // 4. Delete candidate only after merge & sync succeed
            if (fs.existsSync(candidate)) {
                fs.unlinkSync(candidate);
            }

            totalRecovered += records.length;
            console.log(`[RECOVERY SUCCESS] Recovered ${records.length} records (${stats.newlyAddedUnique} unique). SQLite synced (${syncedCount} inserted). Cleaned up ${path.basename(candidate)}.`);

        } catch (err) {
            console.error(`[RECOVERY ERROR] Failed to recover ${path.basename(candidate)}: ${err.message}. Leaving file intact on disk.`);
            if (fs.existsSync(tempOutputFile)) {
                try { fs.unlinkSync(tempOutputFile); } catch (e) {}
            }
        }
    }

    return totalRecovered;
}

module.exports = {
    recoverStagingAndBackupFiles
};
