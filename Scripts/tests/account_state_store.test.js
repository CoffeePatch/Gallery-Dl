const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { AccountStateStore, countOriginalTweets } = require('../lib/accountStateStore');
const { cleanHandle, parseArgs } = require('../AccountBatchProcessing/fetch_orchestrator');

function makeTempDbPath(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
    return { dir, dbPath: path.join(dir, 'test_user_archive.sqlite3') };
}

test('AccountStateStore - defaults to STATE_USER for unrecorded accounts', () => {
    const { dbPath } = makeTempDbPath('state-default');
    const store = new AccountStateStore(dbPath);

    const state = store.getState('alice');
    assert.equal(state.state, 'STATE_USER');
    assert.equal(state.original_tweet_count, 0);
    assert.equal(state.search_reason, null);

    store.close();
});

test('AccountStateStore - persists state transitions correctly', () => {
    const { dbPath } = makeTempDbPath('state-persist');
    const store = new AccountStateStore(dbPath);

    store.setState('alice', {
        state: 'STATE_SEARCH',
        searchReason: 'COUNT_THRESHOLD',
        originalTweetCount: 3194
    });

    const state = store.getState('alice');
    assert.equal(state.state, 'STATE_SEARCH');
    assert.equal(state.search_reason, 'COUNT_THRESHOLD');
    assert.equal(state.original_tweet_count, 3194);

    store.close();

    // Re-open DB to verify state persistence across process restart
    const store2 = new AccountStateStore(dbPath);
    const reloaded = store2.getState('alice');
    assert.equal(reloaded.state, 'STATE_SEARCH');
    assert.equal(reloaded.search_reason, 'COUNT_THRESHOLD');
    assert.equal(reloaded.original_tweet_count, 3194);
    store2.close();
});

test('AccountStateStore - handles PRAGMA user_version schema migration on old database without data loss', () => {
    const { dbPath } = makeTempDbPath('state-migration');

    // Create an "old" gallery-dl database (version 0, gallery_dl table only)
    const oldDb = new Database(dbPath);
    oldDb.exec(`
        CREATE TABLE gallery_dl (
            extractor TEXT,
            id TEXT,
            PRIMARY KEY (extractor, id)
        );
        INSERT INTO gallery_dl (extractor, id) VALUES ('twitter', '111111');
        INSERT INTO gallery_dl (extractor, id) VALUES ('twitter', '222222');
    `);
    assert.equal(oldDb.pragma('user_version', { simple: true }), 0);
    oldDb.close();

    // Run AccountStateStore migration
    const store = new AccountStateStore(dbPath);
    const db = store._getDb();

    // Check version updated
    assert.equal(db.pragma('user_version', { simple: true }), 2);

    // Verify existing gallery_dl data was preserved
    const rows = db.prepare('SELECT id FROM gallery_dl ORDER BY id ASC').all();
    assert.deepEqual(rows, [{ id: '111111' }, { id: '222222' }]);

    // Verify account_fetch_state table now exists and operates
    store.setState('bob', { state: 'COMPLETED', originalTweetCount: 50 });
    assert.equal(store.getState('bob').state, 'COMPLETED');

    store.close();
});

test('countOriginalTweets - correctly filters retweets and external replies', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'count-tweets-'));
    const jsonPath = path.join(dir, 'tweets.json');

    const sampleRecords = [
        [1, { version: '1.0' }],
        // Original tweet by alice
        [2, { tweet_id: '101', retweet_id: 0, reply_to: null, user_id: '1' }],
        // Self reply by alice
        [2, { tweet_id: '102', retweet_id: 0, reply_to: 'alice', user_id: '1' }],
        // Retweet by alice
        [2, { tweet_id: '103', retweet_id: '999', reply_to: null, user_id: '1' }],
        // Reply to bob (external user)
        [2, { tweet_id: '104', retweet_id: 0, reply_to: 'bob', user_id: '1' }],
        // Another original tweet by alice
        [2, { tweet_id: '105', retweet_id: 0, reply_to: '', user_id: '1' }],
    ];

    fs.writeFileSync(jsonPath, JSON.stringify(sampleRecords, null, 2), 'utf8');

    const count = countOriginalTweets(jsonPath, 'alice');
    assert.equal(count, 3); // 101, 102, 105
});

test('cleanHandle - parses handles and URLs properly', () => {
    assert.equal(cleanHandle('alice'), 'alice');
    assert.equal(cleanHandle('https://x.com/alice'), 'alice');
    assert.equal(cleanHandle('https://twitter.com/bob?lang=en'), 'bob');
    assert.equal(cleanHandle('https://www.twitter.com/charlie/status/123'), 'charlie');
});
