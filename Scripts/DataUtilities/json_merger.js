const fs = require('fs');
const path = require('path');
const { getRecordKey } = require('../lib/recordSchema');
const { createStreamingParser } = require('../lib/streamingParser');
const { getPythonCommand } = require('../lib/pythonResolver');
const { preloadIdsFromArchiveStream, mergeStreamsToFile } = require('../lib/streamingMerger');
const { logSubprocessExit } = require('../lib/logger');

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
        const out = execFileSync(getPythonCommand(), [
            path.join(__dirname, 'read_archive_ids.py'), dbFile
        ], { encoding: 'utf8' });
        return new Set(JSON.parse(out));
    } catch (e) {
        console.warn(`[MERGER] Could not read sqlite archive, falling back to RawData-only knownIds: ${e.message}`);
        return new Set();
    }
}

let knownIds = new Set();

async function initializeKnownIds() {
    if (mode.toLowerCase() !== 'overwrite') {
        if (archiveFile) {
            const archivedIds = loadArchivedIds(archiveFile);
            for (const id of archivedIds) {
                knownIds.add(String(id));
            }
        }

        if (fs.existsSync(targetFile)) {
            try {
                await preloadIdsFromArchiveStream(targetFile, knownIds);
            } catch (e) {
                console.warn(`[MERGER] Could not preload RawData JSON IDs: ${e.message}`);
            }
        }
    }
}

const SLIDING_WINDOW_SIZE = 40;
const KNOWN_THRESHOLD = 30;
const recentKnownStatuses = [];
const newRecords = [];
let tripwireFired = false;
let apiErrorDetected = false;
let apiErrorMessage = '';
let gdl = null;
let parser = null;
let graphqlRequestCount = 0;
const visitedCursors = new Set();
let consecutiveKnownCursors = 0;
const MAX_CURSOR_RETRIES = 6;
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

function shortenCursor(cursorValue) {
    if (cursorValue === null || cursorValue === undefined) return '(initial/no cursor)';
    const text = String(cursorValue);
    if (text.length <= 25) return text;
    const mid = Math.floor(text.length / 2);
    return `${text.slice(0, 10)}...[${text.slice(mid - 3, mid + 3)}]...${text.slice(-10)}`;
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

    // Log important gallery-dl messages that might indicate why it "hung"
    if (line.toLowerCase().includes('rate limit') || line.includes('429') || line.includes('WARNING') || line.includes('ERROR')) {
        console.log(`[GALLERY-DL] ${line}`);
    }

    if (line.indexOf('/i/api/graphql/') === -1) return;

    let requestUrl = '';
    const urllib3Match = line.match(/(https?:\/\/[^\s"]+)\s+"[A-Z]+\s+([^"\s]+)/);
    if (urllib3Match) {
        requestUrl = urllib3Match[1] + urllib3Match[2];
    } else {
        const urlMatch = line.match(/https?:\/\/\S+/);
        if (!urlMatch) return;
        requestUrl = urlMatch[0];
    }

    const cursor = parseCursorFromGraphqlUrl(requestUrl);
    const displayCursor = shortenCursor(cursor);
    const requestLabel = summarizeGraphqlRequest(requestUrl);

    graphqlRequestCount += 1;
    if (cursor !== null) {
        lastCursorEncountered = cursor;
        if (visitedCursors.has(cursor)) {
            consecutiveKnownCursors++;
            if (consecutiveKnownCursors >= MAX_CURSOR_RETRIES) {
                console.error(`\n[ABORT] Infinite pagination loop detected!`);
                console.error(`Repeated cursor: ${displayCursor}`);
                console.error(`Occurrences in loop: ${consecutiveKnownCursors}`);
                console.error(`Unique cursors: ${visitedCursors.size}`);
                console.error(`Pagination requests: ${graphqlRequestCount}\n`);
                if (gdl) { try { gdl.kill(); } catch (e) {} }
                saveAndExit(106);
            }
        } else {
            visitedCursors.add(cursor);
            consecutiveKnownCursors = 0;
        }
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
    console.log(`[PAGINATION] Unique Cursors Visited: ${visitedCursors.size}`);
}

function processRecord(record) {
    if (tripwireFired) return;
    
    if (Array.isArray(record) && Number.isInteger(record[0])) {
        // Detect in-band API error records from Twitter / gallery-dl
        if (record[0] === -1 && record[1] && typeof record[1] === 'object' && record[1].error) {
            apiErrorDetected = true;
            apiErrorMessage = `${record[1].error}: ${record[1].message || 'Unknown error'}`;
            console.warn(`[MERGER WARNING] API error response detected from gallery-dl: ${apiErrorMessage}`);
            return; // Do not push error object into newRecords
        }

        newRecords.push(record);
        
        if (!disableDupeAbort && record[0] === 2 && record[1] && record[1].tweet_id && knownIds.size > 0) {
            const isKnown = knownIds.has(String(record[1].tweet_id));
            recentKnownStatuses.push(isKnown);
            
            if (recentKnownStatuses.length > SLIDING_WINDOW_SIZE) {
                recentKnownStatuses.shift();
            }

            if (recentKnownStatuses.length === SLIDING_WINDOW_SIZE) {
                const knownInWindow = recentKnownStatuses.filter(k => k).length;
                if (knownInWindow >= KNOWN_THRESHOLD) {
                    console.error(`[ABORT] Encountered ${knownInWindow} known tweets in the last ${SLIDING_WINDOW_SIZE} tweets. Overlap verified. Stopping fetch.`);
                    if (gdl) { try { gdl.kill(); } catch (e) {} }
                    saveAndExit(106); // distinct code — success, not a tripwire/fallback trigger
                }
            }
        }
    }
}

async function saveAndExit(exitCode) {
    if (tripwireFired) return;
    tripwireFired = true;
    
    printPaginationSummary();

    const finalExitCode = (apiErrorDetected && (exitCode === 0 || exitCode === 106)) ? 65 : exitCode;

    if (newRecords.length === 0) {
        if (apiErrorDetected) {
            console.error(`[MERGER ERROR] gallery-dl encountered API error: ${apiErrorMessage}. No new valid records to process.`);
        } else {
            console.log(`[MERGER] No new JSON metadata found to process for ${targetFile}.`);
        }
        process.exit(finalExitCode);
    }

    console.log(`[MERGER] Captured ${newRecords.length} new records from stream.`);

    const stagingNewFile = targetFile + '.new_staging.json';
    const tempOutputFile = targetFile + '.tmp';

    try {
        fs.writeFileSync(stagingNewFile, JSON.stringify(newRecords, null, 2), 'utf8');

        if (mode.toLowerCase() === 'overwrite' || !fs.existsSync(targetFile)) {
            const stats = await mergeStreamsToFile(null, stagingNewFile, tempOutputFile);
            fs.renameSync(tempOutputFile, targetFile);
            console.log(`[MERGER] Created/Overwritten ${targetFile} with ${stats.totalCount} records.`);
            if (fs.existsSync(stagingNewFile)) fs.unlinkSync(stagingNewFile);
            process.exit(finalExitCode);
        } else {
            console.log(`[MERGER] Streaming and merging into: ${targetFile}...`);
            const stats = await mergeStreamsToFile(targetFile, stagingNewFile, tempOutputFile);
            fs.renameSync(tempOutputFile, targetFile);
            
            if (fs.existsSync(stagingNewFile)) fs.unlinkSync(stagingNewFile);
            
            console.log(`[MERGER] Merged successfully! New total: ${stats.totalCount} records. (Removed ${stats.duplicatesRemoved} overlapping duplicates).`);
            console.log(`[MERGER] Existing records: ${stats.existingCount} | Newly captured: ${newRecords.length} | Newly added (unique): ${stats.newlyAddedUnique} | Final records: ${stats.totalCount}`);
            process.exit(finalExitCode);
        }
    } catch (err) {
        console.error(`[MERGER] Failed to stream or write to target file: ${err.message}`);
        if (fs.existsSync(tempOutputFile)) {
            try { fs.unlinkSync(tempOutputFile); } catch (e) {}
        }
        const backupFile = targetFile + '.backup_new.json';
        fs.writeFileSync(backupFile, JSON.stringify(newRecords, null, 2), 'utf8');
        console.log(`[MERGER] Saved new records to ${backupFile} instead.`);
        process.exit(1);
    }
}

parser = createStreamingParser((record) => {
    processRecord(record);
});

function setupLineReader(inputStream) {
    return parser.setupInputStream(inputStream);
}

async function main() {
    await initializeKnownIds();

    if (isSpawning) {
        const { spawn } = require('child_process');
        gdl = spawn('gallery-dl', galleryDlArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        
        const rl = setupLineReader(gdl.stdout);
        const errRl = require('readline').createInterface({
            input: gdl.stderr,
            terminal: false
        });

        errRl.on('line', processGalleryDlLogLine);
        
        gdl.on('close', async (code) => {
            errRl.close();
            logSubprocessExit('gallery-dl', code || 0);
            if (tripwireFired) return;
            if (code !== 0 && code !== null) {
                console.error(`[MERGER] gallery-dl exited with error code ${code}`);
                await saveAndExit(code);
            } else {
                await saveAndExit(0);
            }
        });

        gdl.on('error', (err) => {
            console.error(`[MERGER] Failed to start gallery-dl process: ${err.message}`);
            process.exit(1);
        });
    } else {
        const rl = setupLineReader(process.stdin);
        rl.on('line', processGalleryDlLogLine);
        
        rl.on('close', async () => {
            if (!tripwireFired) {
                await saveAndExit(0);
            }
        });
    }
}

let isShuttingDown = false;

async function handleSignal(signal, exitCode) {
    if (isShuttingDown || tripwireFired) return;
    isShuttingDown = true;
    console.warn(`\n[MERGER WARNING] Received ${signal}. Initiating graceful shutdown and flushing records...`);

    if (gdl && !gdl.killed) {
        try {
            setTimeout(() => {
                try { if (!gdl.killed) gdl.kill('SIGKILL'); } catch (e) {}
            }, 1000);
        } catch (e) {}
    }

    await saveAndExit(exitCode);
}

process.on('SIGINT', () => { handleSignal('SIGINT', 130); });
process.on('SIGTERM', () => { handleSignal('SIGTERM', 143); });

main().catch((err) => {
    console.error(`[MERGER FATAL] ${err.stack || err.message}`);
    process.exit(1);
});


