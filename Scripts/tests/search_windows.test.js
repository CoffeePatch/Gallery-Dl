const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AccountStateStore } = require('../lib/accountStateStore');

function makeTempPaths(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
    return {
        dir,
        targetJson: path.join(dir, 'target.json'),
        archiveSqlite: path.join(dir, 'archive.sqlite3')
    };
}

test('AccountStateStore - Search Windows Generation and Resume', () => {
    const { archiveSqlite } = makeTempPaths('search-win-test');
    const store = new AccountStateStore(archiveSqlite);

    const username = 'testuser';
    const anchorDate = '2024-05-15';
    
    // 1. Generate windows (6 months)
    store.generateSearchWindows(username, anchorDate, 6);
    
    let windows = store.getIncompleteWindows(username);
    assert.ok(windows.length > 30, 'Should generate over 30 windows going back to 2006');
    
    // Ordered newest to oldest. The first one should end at 2024-05-15.
    assert.equal(windows[0].until_date, '2024-05-15');
    assert.equal(windows[0].since_date, '2023-11-15');
    
    // 2. Simulate interruption (Resume Test)
    store.markWindowCompleted(username, windows[0].since_date, windows[0].until_date);
    store.markWindowCompleted(username, windows[1].since_date, windows[1].until_date);
    
    // Close and reopen to simulate crash/restart
    store.close();
    const storeResumed = new AccountStateStore(archiveSqlite);
    
    const resumedWindows = storeResumed.getIncompleteWindows(username);
    assert.equal(resumedWindows.length, windows.length - 2, 'Should resume skipping the 2 completed windows');
    
    // The first incomplete window should now be the 3rd one originally
    assert.equal(resumedWindows[0].until_date, windows[2].until_date);
    assert.equal(resumedWindows[0].since_date, windows[2].since_date);
    
    storeResumed.close();
});

test('AccountStateStore - Dense Account Custom Window Configuration', () => {
    const { archiveSqlite } = makeTempPaths('search-dense-test');
    const store = new AccountStateStore(archiveSqlite);

    const username = 'denseuser';
    const anchorDate = '2024-05-15';
    
    // Generate windows with 1 month interval instead of 6
    store.generateSearchWindows(username, anchorDate, 1);
    
    const windows = store.getIncompleteWindows(username);
    assert.ok(windows.length > 200, 'Should generate over 200 windows for 1-month intervals');
    assert.equal(windows[0].until_date, '2024-05-15');
    assert.equal(windows[0].since_date, '2024-04-15');
    
    store.close();
});

test('AccountStateStore - Boundary Overlap Verification', () => {
    const { archiveSqlite, targetJson } = makeTempPaths('search-overlap-test');
    const store = new AccountStateStore(archiveSqlite);

    const username = 'overlapuser';
    
    // 1. Simulate STATE_USER inserting a tweet into the DB
    const stateUserRecords = [
        [2, { tweet_id: '123456789' }]
    ];
    fs.writeFileSync(targetJson, JSON.stringify(stateUserRecords), 'utf8');
    store.syncJsonTweets(targetJson);
    
    // 2. Test overlap detection logic
    // We simulate STATE_SEARCH downloading a JSON file that CONTAINS the same tweet
    const searchRecordsOverlap = [
        [2, { tweet_id: '999999999' }],
        [2, { tweet_id: '123456789' }] // The overlap!
    ];
    fs.writeFileSync(targetJson, JSON.stringify(searchRecordsOverlap), 'utf8');
    
    const hasOverlap = store.hasOverlapWithExisting(targetJson);
    assert.equal(hasOverlap, true, 'Should detect overlap because 123456789 is already in SQLite gallery_dl table');
    
    // 3. Test gap scenario (No overlap)
    const searchRecordsGap = [
        [2, { tweet_id: '888888888' }],
        [2, { tweet_id: '777777777' }]
    ];
    fs.writeFileSync(targetJson, JSON.stringify(searchRecordsGap), 'utf8');
    
    const hasNoOverlap = store.hasOverlapWithExisting(targetJson);
    assert.equal(hasNoOverlap, false, 'Should return false when no overlap exists');
    
    store.close();
});
