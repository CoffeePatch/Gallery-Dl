const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { calculateUntilDateFromFile } = require('../lib/dateAnchor');

function makeTempJson(records) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'date-anchor-test-'));
    const filePath = path.join(dir, 'test.json');
    fs.writeFileSync(filePath, JSON.stringify(records), 'utf8');
    return { dir, filePath };
}

test('dateAnchor - parses standard Twitter date format correctly', () => {
    const records = [
        [2, { tweet_id: '101', date: 'Wed May 10 12:00:00 +0000 2023' }],
        [2, { tweet_id: '102', date: 'Thu May 11 12:00:00 +0000 2023' }]
    ];
    const { filePath } = makeTempJson(records);
    const untilDate = calculateUntilDateFromFile(filePath);
    // Oldest is May 10, plus 1 day buffer -> May 12
    assert.equal(untilDate, '2023-05-12');
});

test('dateAnchor - handles ISO date strings', () => {
    const records = [
        [2, { tweet_id: '201', date: '2024-01-15T18:30:00Z' }]
    ];
    const { filePath } = makeTempJson(records);
    const untilDate = calculateUntilDateFromFile(filePath);
    // Jan 15 plus 1 day buffer -> Jan 17
    assert.equal(untilDate, '2024-01-17');
});

test('dateAnchor - ignores pinned tweet date gap anomaly (>30 days gap)', () => {
    const records = [
        [2, { tweet_id: '301', date: '2022-01-01T00:00:00Z' }], // Pinned tweet from 2022
        [2, { tweet_id: '302', date: '2023-06-01T00:00:00Z' }], // Recent timeline
        [2, { tweet_id: '303', date: '2023-06-02T00:00:00Z' }]
    ];
    const { filePath } = makeTempJson(records);
    const untilDate = calculateUntilDateFromFile(filePath);
    // Should skip 2022-01-01 pinned tweet anomaly and pick 2023-06-01 + 1 day -> 2023-06-03
    assert.equal(untilDate, '2023-06-03');
});
