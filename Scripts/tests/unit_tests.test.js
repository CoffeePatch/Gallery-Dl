const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseRecord, getRecordKey } = require('../lib/recordSchema');
const { parseHandle } = require('../lib/handleUtils');
const { createStreamingParser } = require('../lib/streamingParser');
const { getBulkDownloadUrl, getLosslessSnapshotUrl, constructFilename } = require('../lib/download');

test('recordSchema - parseRecord & getRecordKey', (t) => {
    // Array Type 2
    const rec2 = [
        2,
        {
            tweet_id: 123456789,
            conversation_id: 123456789,
            retweet_id: 0,
            author: { name: "testuser" },
            date: "2026-06-01 12:00:00"
        }
    ];
    const p2 = parseRecord(rec2);
    assert.strictEqual(p2.isLegacy, true);
    assert.strictEqual(p2.isMedia, false);
    assert.strictEqual(p2.tweetId, 123456789);
    assert.strictEqual(p2.convoId, 123456789);
    assert.strictEqual(p2.retweetId, 0);
    assert.strictEqual(p2.authorName, "testuser");
    assert.strictEqual(getRecordKey(rec2), '2_123456789');

    // Array Type 3
    const rec3 = [
        3,
        "https://pbs.twimg.com/media/test_image.jpg",
        {
            tweet_id: 123456789,
            type: "photo",
            extension: "jpg"
        }
    ];
    const p3 = parseRecord(rec3);
    assert.strictEqual(p3.isLegacy, false);
    assert.strictEqual(p3.isMedia, true);
    assert.strictEqual(p3.mediaUrl, "https://pbs.twimg.com/media/test_image.jpg");
    assert.strictEqual(p3.type, "photo");
    assert.strictEqual(getRecordKey(rec3), '3_https://pbs.twimg.com/media/test_image.jpg');

    // Flat Object Legacy
    const obj2 = {
        tweet_id: 987654321,
        conversation_id: 987654321,
        retweet_id: 0,
        content: "Flat object test"
    };
    const po2 = parseRecord(obj2);
    assert.strictEqual(po2.isLegacy, true);
    assert.strictEqual(po2.isMedia, false);
    assert.strictEqual(po2.tweetId, 987654321);
    assert.strictEqual(getRecordKey(obj2), '2_987654321');

    // Flat Object Media
    const obj3 = {
        tweet_id: 987654321,
        url: "https://video.twimg.com/ext_tw_video/123/vid/mp4/test.mp4",
        type: "video"
    };
    const po3 = parseRecord(obj3);
    assert.strictEqual(po3.isLegacy, false);
    assert.strictEqual(po3.isMedia, true);
    assert.strictEqual(po3.mediaUrl, "https://video.twimg.com/ext_tw_video/123/vid/mp4/test.mp4");
    assert.strictEqual(po3.type, "video");
    assert.strictEqual(getRecordKey(obj3), '3_https://video.twimg.com/ext_tw_video/123/vid/mp4/test.mp4');

    // Fallback unknown
    const unknown = { custom_field: "value" };
    assert.strictEqual(getRecordKey(unknown), JSON.stringify(unknown));
});

test('accountChecker - parseHandle', (t) => {
    assert.strictEqual(parseHandle("  clean_handle  "), "clean_handle");
    assert.strictEqual(parseHandle("@handle_with_at"), "handle_with_at");
    assert.strictEqual(parseHandle("https://x.com/parodysugam"), "parodysugam");
    assert.strictEqual(parseHandle("twitter.com/elonmusk?ref=123"), "elonmusk");
    assert.strictEqual(parseHandle("# comment line"), null);
    assert.strictEqual(parseHandle("   "), null);
    assert.strictEqual(parseHandle("too_long_handle_name_exceeding_15_chars"), null);
});

test('streamingParser - processLine & golden-file mock stream', (t) => {
    const parsedRecords = [];
    const parser = createStreamingParser((record) => {
        parsedRecords.push(record);
    });

    // 1. Test manual mock stream chunks
    const mockOutputChunks = [
        '[',
        '  [',
        '    2,',
        '    {',
        '      "tweet_id": 1234,',
        '      "content": "Line 1\\nLine 2"',
        '    }',
        '  ],',
        '  [',
        '    3,',
        '    "https://example.com/img.jpg",',
        '    {',
        '      "tweet_id": 1234',
        '    }',
        '  ]',
        ']'
    ];

    mockOutputChunks.forEach(line => {
        parser.processLine(line);
    });

    assert.strictEqual(parsedRecords.length, 2);
    assert.strictEqual(parsedRecords[0][0], 2);
    assert.strictEqual(parsedRecords[0][1].tweet_id, 1234);
    assert.strictEqual(parsedRecords[0][1].content, "Line 1\nLine 2");
    assert.strictEqual(parsedRecords[1][0], 3);
    assert.strictEqual(parsedRecords[1][1], "https://example.com/img.jpg");

    // 2. Test golden-file stream using real captured gallery-dl output file
    const goldenRecords = [];
    const goldenParser = createStreamingParser((record) => {
        goldenRecords.push(record);
    });

    const goldenFilePath = path.join(__dirname, '..', '..', 'Config', 'test_fixtures', 'captured_gdl_stdout.txt');
    const fileContent = fs.readFileSync(goldenFilePath, 'utf8');
    const lines = fileContent.split(/\r?\n/);
    lines.forEach(line => {
        goldenParser.processLine(line);
    });

    assert.strictEqual(goldenRecords.length, 2);
    assert.strictEqual(goldenRecords[0][0], 2);
    assert.strictEqual(goldenRecords[0][1].tweet_id, 180123456789);
    assert.strictEqual(goldenRecords[0][1].content, "Let's test this streaming parser with real output!");
    assert.strictEqual(goldenRecords[1][0], 3);
    assert.strictEqual(goldenRecords[1][1], "https://pbs.twimg.com/media/E_xyz123.jpg");
});

test('download - getBulkDownloadUrl', (t) => {
    assert.strictEqual(getBulkDownloadUrl("https://pbs.twimg.com/media/xyz.jpg?name=medium"), "https://pbs.twimg.com/media/xyz.jpg?name=orig");
    assert.strictEqual(getBulkDownloadUrl("https://example.com/image.png"), "https://example.com/image.png");
    assert.strictEqual(getBulkDownloadUrl(""), "");
    assert.strictEqual(getBulkDownloadUrl(null), "");
});

test('download - getLosslessSnapshotUrl', (t) => {
    assert.strictEqual(getLosslessSnapshotUrl("https://pbs.twimg.com/media/xyz.jpg?name=medium"), "https://pbs.twimg.com/media/xyz.jpg?format=png");
    assert.strictEqual(getLosslessSnapshotUrl("https://example.com/image.png"), "https://example.com/image.png");
    assert.strictEqual(getLosslessSnapshotUrl(""), "");
    assert.strictEqual(getLosslessSnapshotUrl(null), "");
});

test('download - constructFilename', (t) => {
    assert.strictEqual(
        constructFilename("https://pbs.twimg.com/media/xyz.jpg?name=orig", "123456", "2026-06-01 12:00:00"),
        "2026-06-01_12-00-00_123456_xyz.jpg"
    );
    assert.strictEqual(
        constructFilename("https://example.com/vid.mp4", "987654", ""),
        "987654_vid.mp4"
    );
    assert.strictEqual(
        constructFilename("https://example.com/photo.png?size=large"),
        "photo.png"
    );
});

const { preloadIdsFromArchiveStream, mergeStreamsToFile } = require('../lib/streamingMerger');

test('streamingMerger - preload & mergeStreamsToFile', async (t) => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merger-test-'));
    const existingFile = path.join(tmpDir, 'existing.json');
    const newFile = path.join(tmpDir, 'new.json');
    const outputFile = path.join(tmpDir, 'merged.json');

    const existingRecords = [
        [2, { tweet_id: "100", date: "2026-01-01" }],
        [3, "https://pbs.twimg.com/media/m1.jpg", { tweet_id: "100" }]
    ];
    const newRecords = [
        [2, { tweet_id: "101", date: "2026-01-02" }],
        [2, { tweet_id: "100", date: "2026-01-01" }] // duplicate
    ];

    fs.writeFileSync(existingFile, JSON.stringify(existingRecords, null, 2), 'utf8');
    fs.writeFileSync(newFile, JSON.stringify(newRecords, null, 2), 'utf8');

    const knownSet = new Set();
    await preloadIdsFromArchiveStream(existingFile, knownSet);
    assert.strictEqual(knownSet.has("2_100"), true);

    const stats = await mergeStreamsToFile(existingFile, newFile, outputFile, new Set());
    assert.strictEqual(stats.totalCount, 3); // 101, 100(legacy), m1(media)
    assert.strictEqual(stats.duplicatesRemoved, 1);

    const outputContent = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    assert.strictEqual(outputContent.length, 3);
});

