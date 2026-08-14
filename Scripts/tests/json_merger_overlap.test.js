const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function makeTempPaths(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
    return {
        dir,
        targetJson: path.join(dir, 'target.json'),
        archiveSqlite: path.join(dir, 'archive.sqlite3'),
        inputJson: path.join(dir, 'input.json')
    };
}

test('json_merger - sliding window overlap triggers abort correctly', () => {
    const { targetJson, archiveSqlite, inputJson, dir } = makeTempPaths('overlap-test');

    // Create an initial target JSON that defines "known" tweets.
    // Let's assume tweets with ID 100 to 200 are known.
    const knownRecords = [];
    for (let i = 100; i <= 200; i++) {
        knownRecords.push([2, { tweet_id: String(i), date: '2026-01-01' }]);
    }
    fs.writeFileSync(targetJson, JSON.stringify(knownRecords, null, 2), 'utf8');

    // Create an input stream of JSON records that json_merger will read from stdin.
    // It should simulate gallery-dl output.
    // We will provide:
    // 5 unknown tweets
    // 15 known tweets
    // 1 unknown tweet (e.g. pinned tweet)
    // 15 known tweets
    // Total known tweets in window = 30. Total window size = 31 < 40.
    // We need 30 known tweets in the last 40 to trigger the KNOWN_THRESHOLD=30 abort.

    const streamRecords = [];
    
    // 5 unknown
    for (let i = 1; i <= 5; i++) {
        streamRecords.push(`[2, {"tweet_id": "${i}", "date": "2026-01-02"}]`);
    }
    
    // 15 known
    for (let i = 100; i < 115; i++) {
        streamRecords.push(`[2, {"tweet_id": "${i}", "date": "2026-01-01"}]`);
    }
    
    // 1 unknown (simulates ad/pinned tweet out of order)
    streamRecords.push(`[2, {"tweet_id": "9999", "date": "2026-01-02"}]`);
    
    // 25 more known -> reaches 40 known total, last 40 tweets will definitely hit threshold
    for (let i = 115; i < 140; i++) {
        streamRecords.push(`[2, {"tweet_id": "${i}", "date": "2026-01-01"}]`);
    }

    // A few extra to prove we didn't process them because it aborted
    streamRecords.push(`[2, {"tweet_id": "9998", "date": "2026-01-02"}]`);
    streamRecords.push(`[2, {"tweet_id": "9997", "date": "2026-01-02"}]`);

    const streamStr = '[\n' + streamRecords.join(',\n') + '\n]';
    fs.writeFileSync(inputJson, streamStr, 'utf8');

    const mergerScript = path.join(__dirname, '..', 'DataUtilities', 'json_merger.js');

    // Run json_merger.js using stdin
    // node json_merger.js <target_file> default user_xyz <sqlite_file>
    const result = spawnSync(process.execPath, [mergerScript, targetJson, 'default', 'user_xyz', archiveSqlite], {
        input: streamStr,
        encoding: 'utf8'
    });
    console.log("MERGER STDOUT:", result.stdout);
    console.log("MERGER STDERR:", result.stderr);

    // It should abort with exit code 106
    assert.equal(result.status, 106, 'json_merger should exit with 106 when overlap is verified');

    // We can also verify that the output indicates the abort condition
    assert.match(result.stderr || result.stdout, /\[ABORT\] Encountered \d+ known tweets/);
});

test('json_merger - sliding window clears old states and avoids premature abort', () => {
    const { targetJson, archiveSqlite, inputJson } = makeTempPaths('overlap-clear-test');

    const knownRecords = [];
    for (let i = 100; i <= 200; i++) {
        knownRecords.push([2, { tweet_id: String(i), date: '2026-01-01' }]);
    }
    fs.writeFileSync(targetJson, JSON.stringify(knownRecords, null, 2), 'utf8');

    const streamRecords = [];
    
    // 10 known
    for (let i = 100; i < 110; i++) {
        streamRecords.push(`[2, {"tweet_id": "${i}", "date": "2026-01-01"}]`);
    }
    
    // 50 unknown (pushes the 10 knowns out of the sliding window of 40)
    for (let i = 1; i <= 50; i++) {
        streamRecords.push(`[2, {"tweet_id": "${i}", "date": "2026-01-02"}]`);
    }
    
    // 20 known (total known is 30, but only 20 are in the sliding window)
    for (let i = 110; i < 130; i++) {
        streamRecords.push(`[2, {"tweet_id": "${i}", "date": "2026-01-01"}]`);
    }

    const streamStr = '[\n' + streamRecords.join(',\n') + '\n]';
    fs.writeFileSync(inputJson, streamStr, 'utf8');

    const mergerScript = path.join(__dirname, '..', 'DataUtilities', 'json_merger.js');

    const result = spawnSync(process.execPath, [mergerScript, targetJson, 'default', 'user_xyz', archiveSqlite], {
        input: streamStr,
        encoding: 'utf8'
    });

    // Should NOT abort with 106, it should complete successfully (exit 0) because the window never had 30 knowns at the same time
    assert.equal(result.status, 0, 'json_merger should complete with exit code 0');
});
