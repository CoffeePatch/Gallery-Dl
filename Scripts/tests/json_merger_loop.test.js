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
        inputLog: path.join(dir, 'input.log')
    };
}

function makeLogLine(cursor) {
    const variables = encodeURIComponent(JSON.stringify({ cursor }));
    // Must match json_merger's regex: /(https?:\/\/[^\s"]+)\s+"[A-Z]+\s+([^"\s]+)/
    // And must include '/i/api/graphql/'
    return `[urllib3.connectionpool] DEBUG: https://api.twitter.com:443 "GET /i/api/graphql/xyz/UserTweets?variables=${variables} HTTP/1.1" 200 None`;
}

function runMerger(streamStr, targetJson, archiveSqlite) {
    const mergerScript = path.join(__dirname, '..', 'DataUtilities', 'json_merger.js');
    return spawnSync(process.execPath, [mergerScript, targetJson, 'default', 'user_xyz', archiveSqlite, 'no-tripwire'], {
        input: streamStr,
        encoding: 'utf8'
    });
}

test('json_merger - Normal pagination (No abort)', () => {
    const { targetJson, archiveSqlite } = makeTempPaths('loop-test-1');
    fs.writeFileSync(targetJson, '[\n]', 'utf8'); // Empty array

    const streamRecords = [
        makeLogLine('A'),
        makeLogLine('B'),
        makeLogLine('C'),
        makeLogLine('D'),
        makeLogLine('E')
    ];
    
    const result = runMerger(streamRecords.join('\n'), targetJson, archiveSqlite);
    assert.equal(result.status, 0, 'Should complete successfully');
    assert.doesNotMatch(result.stderr || '', /\[ABORT\]/);
});

test('json_merger - Legitimate retry (No abort)', () => {
    const { targetJson, archiveSqlite } = makeTempPaths('loop-test-2');
    fs.writeFileSync(targetJson, '[\n]', 'utf8');

    const streamRecords = [
        makeLogLine('A'),
        makeLogLine('A'), // Retry 1
        makeLogLine('A'), // Retry 2
        makeLogLine('B'),
        makeLogLine('C')
    ];
    
    const result = runMerger(streamRecords.join('\n'), targetJson, archiveSqlite);
    assert.equal(result.status, 0, 'Should complete successfully');
});

test('json_merger - Alternating loop (Aborts)', () => {
    const { targetJson, archiveSqlite } = makeTempPaths('loop-test-3');
    fs.writeFileSync(targetJson, '[\n]', 'utf8');

    const streamRecords = [
        makeLogLine('A'),
        makeLogLine('B'),
        makeLogLine('A'),
        makeLogLine('B'),
        makeLogLine('A'),
        makeLogLine('B'),
        makeLogLine('A'),
        makeLogLine('B')
    ];
    
    const result = runMerger(streamRecords.join('\n'), targetJson, archiveSqlite);
    assert.equal(result.status, 106, 'Should abort with 106');
    assert.match(result.stderr || '', /\[ABORT\] Infinite pagination loop detected!/);
});

test('json_merger - Three-node loop (Aborts)', () => {
    const { targetJson, archiveSqlite } = makeTempPaths('loop-test-4');
    fs.writeFileSync(targetJson, '[\n]', 'utf8');

    const streamRecords = [
        makeLogLine('A'),
        makeLogLine('B'),
        makeLogLine('C'),
        makeLogLine('A'),
        makeLogLine('B'),
        makeLogLine('C'),
        makeLogLine('A'),
        makeLogLine('B'),
        makeLogLine('C')
    ];
    
    const result = runMerger(streamRecords.join('\n'), targetJson, archiveSqlite);
    assert.equal(result.status, 106, 'Should abort with 106');
    assert.match(result.stderr || '', /\[ABORT\] Infinite pagination loop detected!/);
});

test('json_merger - Long successful session with scattered revisits (No abort)', () => {
    const { targetJson, archiveSqlite } = makeTempPaths('loop-test-5');
    fs.writeFileSync(targetJson, '[\n]', 'utf8');

    const streamRecords = [
        makeLogLine('A'),
        makeLogLine('B'),
        makeLogLine('C'),
        makeLogLine('A'), // Revisit A
        makeLogLine('D'),
        makeLogLine('E'),
        makeLogLine('A')  // Revisit A
    ];
    
    const result = runMerger(streamRecords.join('\n'), targetJson, archiveSqlite);
    assert.equal(result.status, 0, 'Should complete successfully without false positive abort');
});
