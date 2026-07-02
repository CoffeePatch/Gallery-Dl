const fs = require('fs');
const path = require('path');
const { parseRecord } = require('./lib/recordSchema');
const { downloadWithRetry, getNormalizedUrl, constructFilename } = require('./lib/download');
const { MEDIA_DOWNLOAD_DELAY_MS } = require('./lib/rateLimits');

// CLI Flags
const args = process.argv.slice(2);
const VIDEOS_ONLY = args.includes('--videos-only') || args.includes('-v');
const IMAGES_ONLY = args.includes('--images-only') || args.includes('-i');

const maxGbIndex = args.findIndex(arg => arg === '--max-gb');
const MAX_GB = maxGbIndex !== -1 ? parseFloat(args[maxGbIndex + 1]) : null;
const MAX_BYTES = MAX_GB ? MAX_GB * 1024 * 1024 * 1024 : null;

const IGNORE_THREADS = !args.includes('--include-threads');
const IGNORE_LARGE_VIDEOS = !args.includes('--include-large-videos');

// Global State
let totalDownloadedBytes = 0;
let stopRequested = false;

if (VIDEOS_ONLY && IMAGES_ONLY) {
    console.error("Error: Cannot use both video-only and image-only flags at the same time.");
    process.exit(1);
}

// Global Configuration
const CONCURRENCY = 5; // How many concurrent downloads to run across the entire application
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 2000; // Exponential backoff base delay

const { NEW_RAW_DATA_DIR: DIRECTORY, MEDIA_DIR: OUTPUT_DIR } = require('./lib/paths');
const MAPPING_DIR = path.join(OUTPUT_DIR, 'Mappings');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(MAPPING_DIR)) {
    fs.mkdirSync(MAPPING_DIR, { recursive: true });
}

// Ensure the directory to process exists
if (!fs.existsSync(DIRECTORY)) {
    console.error(`Error: Data directory '${DIRECTORY}' not found.`);
    process.exit(1);
}

// --- Utilities ---

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// --- Core Logic ---

async function processFile(filePath, workerId) {
    const fileName = path.basename(filePath);
    const accountName = fileName.replace('.json', '');
    const accountMediaDir = path.join(OUTPUT_DIR, accountName);
    
    // We'll store mappings inside the unified mappings directory
    const mappingFilePath = path.join(MAPPING_DIR, `${accountName}_media_map.json`);

    console.log(`[Worker ${workerId}] Starting ${fileName}`);

    let dataRaw;
    try {
        dataRaw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        console.error(`[Worker ${workerId}] Failed to read ${fileName}:`, err);
        return;
    }

    let records;
    try {
        records = JSON.parse(dataRaw);
    } catch (err) {
        console.error(`[Worker ${workerId}] Invalid JSON in ${fileName}:`, err);
        return;
    }

    // --- Thread Pre-processing ---
    const threadConvoIds = new Set();
    if (IGNORE_THREADS) {
        const convoMap = new Map();
        for (const record of records) {
            const parsed = parseRecord(record);
            if (parsed.convoId && parsed.tweetId) {
                if (!convoMap.has(parsed.convoId)) convoMap.set(parsed.convoId, new Set());
                convoMap.get(parsed.convoId).add(parsed.tweetId);
            }
        }
        for (const [convoId, tweetIds] of convoMap.entries()) {
            if (tweetIds.size > 1) threadConvoIds.add(convoId);
        }
    }
    // -----------------------------

    // Filter media records based on CLI flags
    const mediaRecords = records.filter(record => {
        const parsed = parseRecord(record);
        
        if (IGNORE_THREADS && parsed.convoId && threadConvoIds.has(parsed.convoId)) {
            return false; // Skip threads
        }

        if (!parsed.isMedia) return false;

        const isVideo = parsed.type === 'video' || parsed.type === 'animated_gif';
        const isImage = parsed.type === 'photo';

        if (IGNORE_LARGE_VIDEOS && isVideo && parsed.duration !== null && parsed.duration !== undefined) {
            const durationSec = parseFloat(parsed.duration);
            if (!isNaN(durationSec) && durationSec >= 1800) {
                return false; // Skip large videos >= 30m (1800s)
            }
        }

        if (VIDEOS_ONLY && !isVideo) return false;
        if (IMAGES_ONLY && !isImage) return false;

        return true;
    });

    if (mediaRecords.length === 0) {
        console.log(`[Worker ${workerId}] No media found in ${fileName}`);
        return;
    }

    console.log(`[Worker ${workerId}] Found ${mediaRecords.length} media items in ${fileName}`);
    ensureDirectoryExists(accountMediaDir);

    let mapping = {};
    if (fs.existsSync(mappingFilePath)) {
        try {
            mapping = JSON.parse(fs.readFileSync(mappingFilePath, 'utf8'));
        } catch (e) {
            console.warn(`[Worker ${workerId}] Could not parse existing mapping file for ${accountName}, starting fresh.`);
            mapping = {};
        }
    }

    let downloadedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < mediaRecords.length; i++) {
        if (stopRequested) break;
        
        const record = mediaRecords[i];
        
        const parsed = parseRecord(record);
        let mediaUrl = parsed.mediaUrl;
        let tweetId = parsed.tweetId || '';
        let dateStr = parsed.date || '';

        if (!mediaUrl) continue;

        mediaUrl = getNormalizedUrl(mediaUrl);
        const localFileName = constructFilename(mediaUrl, tweetId, dateStr);
        const destPath = path.join(accountMediaDir, localFileName);
        const relativePath = `${accountName}/${localFileName}`;

        // Check mapping to avoid duplicate downloads
        if (mapping[mediaUrl] && fs.existsSync(path.join(OUTPUT_DIR, mapping[mediaUrl]))) {
            skippedCount++;
            continue;
        }

        // Sometimes the mapping is missing but the file exists locally
        if (fs.existsSync(destPath)) {
            skippedCount++;
            mapping[mediaUrl] = relativePath;
            continue;
        }

        console.log(`   [Worker ${workerId}] [${accountName}] Downloading: ${localFileName}`);
        const success = await downloadWithRetry(mediaUrl, destPath);

        if (success) {
            downloadedCount++;
            mapping[mediaUrl] = relativePath;
            // Update mapping file progressively
            fs.writeFileSync(mappingFilePath, JSON.stringify(mapping, null, 2));

            // Note: size limit check is approximate/best-effort due to concurrent workers downloading in parallel.
            // Check file size and update global counter
            if (MAX_BYTES) {
                try {
                    const stats = fs.statSync(destPath);
                    totalDownloadedBytes += stats.size;
                    
                    if (totalDownloadedBytes >= MAX_BYTES) {
                        console.log(`\n[!] Reached size limit of ${MAX_GB} GB (${totalDownloadedBytes} bytes). Halting further downloads.\n`);
                        stopRequested = true;
                    }
                } catch (e) {
                    console.error(`   [Worker ${workerId}] Could not stat file ${destPath}:`, e);
                }
            }
        } else {
            errorCount++;
        }

        // Brief delay between downloads for rate-limiting (0.5s per doc limits)
        await sleep(MEDIA_DOWNLOAD_DELAY_MS);
    }

    console.log(`[Worker ${workerId}] Finished ${fileName}. Downloaded: ${downloadedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
}

// --- Worker Pool Implementation ---

async function startWorkerPool() {
    const files = fs.readdirSync(DIRECTORY).filter(file => file.endsWith('.json'));
    
    if (files.length === 0) {
        console.log("No JSON files found in data directory.");
        return;
    }

    console.log(`Found ${files.length} JSON files to process.`);
    console.log(`Starting with concurrency level of ${CONCURRENCY}...`);

    let index = 0;

    // Worker function: pulls from the shared queue (files array)
    async function worker(workerId) {
        while (index < files.length && !stopRequested) {
            const fileToProcess = files[index++];
            const filePath = path.join(DIRECTORY, fileToProcess);
            await processFile(filePath, workerId);
        }
    }

    // Spawn workers up to CONCURRENCY limit
    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
        workers.push(worker(i + 1));
    }

    // Wait for all workers to finish
    await Promise.all(workers);
    console.log("\nAll media downloads completed!");
}

startWorkerPool().catch(err => {
    console.error("Fatal Error:", err);
});
