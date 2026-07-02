const fs = require('fs');
const path = require('path');
const { getRecordKey } = require('./lib/recordSchema');
const { createStreamingParser } = require('./lib/streamingParser');

// Usage: node json_merger.js <target_file_path> <mode> [clean_username] [no-tripwire] [-- <gallery-dl arguments>]
// Modes: overwrite, skip, default

const targetFile = process.argv[2];
const mode = process.argv[3] || 'default';
const targetUsername = process.argv[4] ? process.argv[4].toLowerCase() : '';

// Detect if we should spawn gallery-dl or read from stdin
const dashDashIndex = process.argv.indexOf('--');
const isSpawning = dashDashIndex !== -1;

// If we are spawning, the arguments after '--' are the gallery-dl arguments.
let disableTripwire = false;
let galleryDlArgs = [];

if (isSpawning) {
    galleryDlArgs = process.argv.slice(dashDashIndex + 1);
    // Search for 'no-tripwire' in args before '--'
    for (let i = 2; i < dashDashIndex; i++) {
        if (process.argv[i] === 'no-tripwire') {
            disableTripwire = true;
        }
    }
} else {
    disableTripwire = process.argv[5] === 'no-tripwire';
}

if (!targetFile) {
    console.error("No target file specified.");
    process.exit(1);
}

const newRecords = [];
let tripwireFired = false;
let gdl = null;
let parser = null;

function processRecord(record) {
    if (tripwireFired) return;
    
    if (Array.isArray(record) && Number.isInteger(record[0])) {
        newRecords.push(record);
        
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
    if (newRecords.length === 0) {
        console.log(`[MERGER] No new JSON metadata found to process for ${targetFile}.`);
        process.exit(exitCode);
    }

    console.log(`[MERGER] Captured ${newRecords.length} new records from stream.`);

    if (mode.toLowerCase() === 'overwrite' || !fs.existsSync(targetFile)) {
        // If overwrite mode, or file doesn't exist, just save the new records
        fs.writeFileSync(targetFile, JSON.stringify(newRecords, null, 2), 'utf8');
        console.log(`[MERGER] Created/Overwritten ${targetFile} with ${newRecords.length} records.`);
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
            fs.writeFileSync(targetFile, JSON.stringify(combined, null, 2), 'utf8');
            console.log(`[MERGER] Merged successfully! New total: ${combined.length} records. (Removed ${duplicatesRemoved} overlapping duplicates).`);
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
    gdl = spawn('gallery-dl', galleryDlArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
    
    const rl = setupLineReader(gdl.stdout);
    
    gdl.on('close', (code) => {
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


