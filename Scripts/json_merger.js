const fs = require('fs');
const path = require('path');
const { getRecordKey } = require('./lib/recordSchema');
const { createStreamingParser } = require('./lib/streamingParser');

// Usage: node json_merger.js <target_file_path> <mode> [clean_username] [no-tripwire] [-- <gallery-dl arguments>]
// Modes: overwrite, skip, default

const targetFile = process.argv[2];
const mode = process.argv[3] || 'default';
const targetUsername = process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4].toLowerCase() : '';

let archiveFile = '';
if (process.argv[5] && !['no-tripwire', 'no-dupe-abort', '--'].includes(process.argv[5])) {
    archiveFile = process.argv[5];
}

// Detect if we should spawn gallery-dl or read from stdin
const dashDashIndex = process.argv.indexOf('--');
const isSpawning = dashDashIndex !== -1;

// If we are spawning, the arguments after '--' are the gallery-dl arguments.
let disableTripwire = false;
let disableDupeAbort = false;
let galleryDlArgs = [];

if (isSpawning) {
    galleryDlArgs = process.argv.slice(dashDashIndex + 1);
    // Search for 'no-tripwire' or 'no-dupe-abort' in args before '--'
    for (let i = 2; i < dashDashIndex; i++) {
        if (process.argv[i] === 'no-tripwire') {
            disableTripwire = true;
        }
        if (process.argv[i] === 'no-dupe-abort') {
            disableDupeAbort = true;
        }
    }
} else {
    disableTripwire = process.argv.includes('no-tripwire');
    disableDupeAbort = process.argv.includes('no-dupe-abort');
}

if (!targetFile) {
    console.error("No target file specified.");
    process.exit(1);
}

function loadArchivedIds(dbFile) {
    if (!fs.existsSync(dbFile)) return new Set();
    try {
        const { execFileSync } = require('child_process');
        const out = execFileSync('python', [
            path.join(__dirname, 'read_archive_ids.py'), dbFile
        ], { encoding: 'utf8' });
        return new Set(JSON.parse(out));
    } catch (e) {
        console.warn(`[MERGER] Could not read sqlite archive, falling back to RawData-only knownIds: ${e.message}`);
        return new Set();
    }
}

let knownIds = new Set();
if (isSpawning && mode.toLowerCase() !== 'overwrite') {
    if (archiveFile) {
        const archivedIds = loadArchivedIds(archiveFile);
        for (const id of archivedIds) {
            knownIds.add(String(id));
        }
    }

    if (fs.existsSync(targetFile)) {
        try {
            const existing = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
            for (const r of existing) {
                if (Array.isArray(r) && r[0] === 2 && r[1] && r[1].tweet_id) {
                    knownIds.add(String(r[1].tweet_id));
                }
            }
        } catch (e) {
            console.warn(`[MERGER] Could not preload RawData JSON IDs: ${e.message}`);
        }
    }
}

const ABORT_THRESHOLD = 5;
let consecutiveKnown = 0;

const newRecords = [];
let tripwireFired = false;
let gdl = null;
let parser = null;
let graphqlRequestCount = 0;
let lastCursorEncountered = null;

function parseCursorFromGraphqlUrl(urlString) {
    try {
        const url = new URL(urlString);
        const variablesRaw = url.searchParams.get('variables');
        if (!variablesRaw) return null;
        const variables = JSON.parse(variablesRaw);
        if (Object.prototype.hasOwnProperty.call(variables, 'cursor')) {
            return String(variables.cursor);
        }
        return null;
    } catch (e) {
        return null;
    }
}

function shortenCursor(cursorValue, visibleChars = 13) {
    if (cursorValue === null || cursorValue === undefined) return '(initial/no cursor)';
    const text = String(cursorValue);
    if (text.length <= visibleChars) return text;
    return `${text.slice(0, visibleChars)}...`;
}

function summarizeGraphqlRequest(urlString) {
    try {
        const url = new URL(urlString);
        const match = url.pathname.match(/\/graphql\/([^/]+)\/([^/?]+)/);
        const queryId = match ? match[1] : 'unknown';
        const endpoint = match ? match[2] : 'unknown';
        return `${endpoint} (queryId: ${queryId})`;
    } catch (e) {
        return 'unknown-endpoint';
    }
}

function processGalleryDlLogLine(line) {
    if (!line || typeof line !== 'string') return;

    if (line.indexOf('/i/api/graphql/') === -1) return;

    const urlMatch = line.match(/https?:\/\/\S+/);
    if (!urlMatch) return;

    const requestUrl = urlMatch[0];
    const cursor = parseCursorFromGraphqlUrl(requestUrl);
    const displayCursor = shortenCursor(cursor);
    const requestLabel = summarizeGraphqlRequest(requestUrl);

    graphqlRequestCount += 1;
    if (cursor !== null) {
        lastCursorEncountered = cursor;
    }

    console.log(`[GRAPHQL] Request ${graphqlRequestCount}: ${requestLabel}`);
    console.log(`[PAGINATION] Page ${graphqlRequestCount} Cursor: ${displayCursor}`);
}

function printPaginationSummary() {
    if (graphqlRequestCount === 0) {
        console.log('[PAGINATION] No GraphQL request lines were detected in gallery-dl output.');
        return;
    }

    const finalCursor = shortenCursor(lastCursorEncountered, 13);
    console.log(`[PAGINATION] Final Cursor: ${finalCursor}`);
}

function processRecord(record) {
    if (tripwireFired) return;
    
    if (Array.isArray(record) && Number.isInteger(record[0])) {
        newRecords.push(record);
        
        if (!disableDupeAbort && record[0] === 2 && record[1] && record[1].tweet_id && knownIds.size > 0) {
            if (knownIds.has(String(record[1].tweet_id))) {
                consecutiveKnown++;
                if (consecutiveKnown >= ABORT_THRESHOLD) {
                    console.error(`[ABORT] ${ABORT_THRESHOLD} consecutive known tweets encountered. Stopping fetch — nothing new beyond this point.`);
                    if (gdl) { try { gdl.kill(); } catch (e) {} }
                    saveAndExit(106); // distinct code — success, not a tripwire/fallback trigger
                }
            } else {
                consecutiveKnown = 0;
            }
        }
        
        // Tripwire Check: Detect if gallery-dl switched to Search fallback and is emitting replies to other users
        if (!disableTripwire && targetUsername && record[0] === 2 && record[1]) {
            const tweet = record[1];
            const isRetweet = tweet.retweet_id && tweet.retweet_id !== 0;
            
            if (!isRetweet && tweet.reply_to) {
                const replyTo = tweet.reply_to.toLowerCase();
                if (replyTo !== targetUsername) {
                    console.error(`[TRIPWIRE] Fired! Detected reply to another user: ${tweet.reply_to}`);
                    tripwireFired = true;
                    if (parser) parser.setTripwireFired(true);
                    if (gdl) {
                        try {
                            gdl.kill();
                        } catch (e) {
                            // ignore error if already terminated
                        }
                    }
                    saveAndExit(105);
                }
            }
        }
    }
}

function saveAndExit(exitCode) {
    printPaginationSummary();

    if (newRecords.length === 0) {
        console.log(`[MERGER] No new JSON metadata found to process for ${targetFile}.`);
        process.exit(exitCode);
    }

    console.log(`[MERGER] Captured ${newRecords.length} new records from stream.`);

    if (mode.toLowerCase() === 'overwrite' || !fs.existsSync(targetFile)) {
        let existingCount = 0;
        if (fs.existsSync(targetFile)) {
            try {
                const rawExisting = fs.readFileSync(targetFile, 'utf8');
                const parsed = rawExisting.trim() ? JSON.parse(rawExisting) : [];
                if (Array.isArray(parsed)) {
                    existingCount = parsed.length;
                }
            } catch (e) {
                // Keep existingCount at 0 when old file is unreadable.
            }
        }

        // If overwrite mode, or file doesn't exist, just save the new records
        fs.writeFileSync(targetFile, JSON.stringify(newRecords, null, 2), 'utf8');
        console.log(`[MERGER] Created/Overwritten ${targetFile} with ${newRecords.length} records.`);
        console.log(`[MERGER] Existing records before write: ${existingCount} | Newly captured: ${newRecords.length} | Final records: ${newRecords.length}`);
        process.exit(exitCode);
    } else {
        // Mode is skip or default: read existing file, prepend new records
        try {
            console.log(`[MERGER] Reading existing file: ${targetFile}...`);
            const rawData = fs.readFileSync(targetFile, 'utf8');
            let existingRecords = [];
            
            if (rawData.trim()) {
                existingRecords = JSON.parse(rawData);
            }
            
            if (!Array.isArray(existingRecords)) {
                console.warn(`[MERGER] Existing file was not a JSON array. Resetting.`);
                existingRecords = [];
            }

            const existingCount = existingRecords.length;
 
            // Prepend new records and deduplicate
            const allRecords = newRecords.concat(existingRecords);
            const combined = [];
            const seen = new Set();
            
            for (const record of allRecords) {
                const key = getRecordKey(record);
                if (!seen.has(key)) {
                    seen.add(key);
                    combined.push(record);
                }
            }
            
            const duplicatesRemoved = allRecords.length - combined.length;
            const newlyAddedUnique = Math.max(0, combined.length - existingCount);
            fs.writeFileSync(targetFile, JSON.stringify(combined, null, 2), 'utf8');
            console.log(`[MERGER] Merged successfully! New total: ${combined.length} records. (Removed ${duplicatesRemoved} overlapping duplicates).`);
            console.log(`[MERGER] Existing records: ${existingCount} | Newly captured: ${newRecords.length} | Newly added (unique): ${newlyAddedUnique} | Final records: ${combined.length}`);
            process.exit(exitCode);
        } catch (err) {
            console.error(`[MERGER] Failed to parse or write to existing file: ${err.message}`);
            // Fallback: save to a backup file so data isn't lost
            const backupFile = targetFile + '.backup_new.json';
            fs.writeFileSync(backupFile, JSON.stringify(newRecords, null, 2), 'utf8');
            console.log(`[MERGER] Saved new records to ${backupFile} instead.`);
            process.exit(1);
        }
    }
}

parser = createStreamingParser((record) => {
    processRecord(record);
});

function setupLineReader(inputStream) {
    return parser.setupInputStream(inputStream);
}

if (isSpawning) {
    const { spawn } = require('child_process');
    gdl = spawn('gallery-dl', galleryDlArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    
    const rl = setupLineReader(gdl.stdout);
    const errRl = require('readline').createInterface({
        input: gdl.stderr,
        terminal: false
    });

    errRl.on('line', processGalleryDlLogLine);
    
    gdl.on('close', (code) => {
        errRl.close();
        if (tripwireFired) return;
        if (code !== 0 && code !== null) {
            console.error(`[MERGER] gallery-dl exited with error code ${code}`);
            saveAndExit(code);
        } else {
            saveAndExit(0);
        }
    });

    gdl.on('error', (err) => {
        console.error(`[MERGER] Failed to start gallery-dl process: ${err.message}`);
        process.exit(1);
    });
} else {
    const rl = setupLineReader(process.stdin);
    
    rl.on('close', () => {
        if (!tripwireFired) {
            saveAndExit(0);
        }
    });
}


