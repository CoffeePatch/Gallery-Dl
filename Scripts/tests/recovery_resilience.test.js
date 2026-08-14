const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AccountStateStore } = require('../lib/accountStateStore');
const { recoverStagingAndBackupFiles } = require('../lib/recoveryHelper');

function makeTempPaths(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
    return {
        dir,
        targetJson: path.join(dir, 'target.json'),
        archiveSqlite: path.join(dir, 'archive.sqlite3')
    };
}

test('recoveryHelper - Idempotent Recovery', async () => {
    const { dir, targetJson, archiveSqlite } = makeTempPaths('rec-idempotent');
    const store = new AccountStateStore(archiveSqlite);

    const backupFile = targetJson + '.backup_new.json';
    const sampleRecords = [
        [2, { tweet_id: '1000001', date: '2024-01-01' }],
        [2, { tweet_id: '1000002', date: '2024-01-02' }]
    ];
    fs.writeFileSync(backupFile, JSON.stringify(sampleRecords, null, 2), 'utf8');

    // First recovery run
    const count1 = await recoverStagingAndBackupFiles(targetJson, store);
    assert.equal(count1, 2, 'First recovery run should recover 2 records');
    assert.equal(fs.existsSync(backupFile), false, 'Backup file should be unlinked after successful recovery');
    assert.equal(fs.existsSync(targetJson), true, 'Target JSON should exist with recovered records');

    // Verify SQLite synced
    const db = store._getDb();
    const rows = db.prepare('SELECT id FROM gallery_dl ORDER BY id ASC').all();
    assert.deepEqual(rows, [{ id: '1000001' }, { id: '1000002' }]);

    // Second recovery run (Idempotency check)
    const count2 = await recoverStagingAndBackupFiles(targetJson, store);
    assert.equal(count2, 0, 'Second recovery run should recover 0 records');
    
    store.close();
});

test('recoveryHelper - Corrupted File Guard', async () => {
    const { dir, targetJson, archiveSqlite } = makeTempPaths('rec-corrupt');
    const store = new AccountStateStore(archiveSqlite);

    const stagingFile = targetJson + '.new_staging.json';
    // Write invalid truncated JSON
    fs.writeFileSync(stagingFile, '[{"tweet_id": "999", "truncated": ', 'utf8');

    const count = await recoverStagingAndBackupFiles(targetJson, store);
    assert.equal(count, 0, 'Should not recover corrupted file');
    assert.equal(fs.existsSync(stagingFile), true, 'Corrupted recovery file MUST remain intact on disk for inspection');
    assert.equal(fs.existsSync(targetJson), false, 'Target JSON should not be created from corrupted backup');

    store.close();
});

test('recoveryHelper - Transactional Recovery Sequence', async () => {
    const { dir, targetJson, archiveSqlite } = makeTempPaths('rec-transactional');
    const store = new AccountStateStore(archiveSqlite);

    // Existing target file with 1 record
    const existingRecords = [
        [2, { tweet_id: '2000001' }]
    ];
    fs.writeFileSync(targetJson, JSON.stringify(existingRecords, null, 2), 'utf8');
    store.syncJsonTweets(targetJson);

    // Staging file with 1 new record and 1 duplicate record
    const stagingFile = targetJson + '.new_staging.json';
    const stagingRecords = [
        [2, { tweet_id: '2000001' }], // Duplicate
        [2, { tweet_id: '2000002' }]  // New
    ];
    fs.writeFileSync(stagingFile, JSON.stringify(stagingRecords, null, 2), 'utf8');

    const count = await recoverStagingAndBackupFiles(targetJson, store);
    assert.equal(count, 2, 'Should process 2 records from staging');
    assert.equal(fs.existsSync(stagingFile), false, 'Staging file should be unlinked after merge');

    // Verify target file merged cleanly
    const mergedRaw = fs.readFileSync(targetJson, 'utf8');
    const merged = JSON.parse(mergedRaw);
    assert.equal(merged.length, 2, 'Merged target file should contain 2 unique records');

    // Verify SQLite contains both IDs
    const db = store._getDb();
    const rows = db.prepare('SELECT id FROM gallery_dl ORDER BY id ASC').all();
    assert.deepEqual(rows, [{ id: '2000001' }, { id: '2000002' }]);

    store.close();
});
