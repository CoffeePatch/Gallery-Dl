const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

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

const DIRECTORY = path.join(__dirname, '..', 'TweetData', 'NewRawData');
const OUTPUT_DIR = path.join(__dirname, '..', 'TweetData', 'Media');
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// Download a single file using a Promise
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        
        const req = client.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Handle redirects
                return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
            }
            
            if (res.statusCode !== 200) {
                return reject(new Error(`Failed to get '${url}' (${res.statusCode})`));
            }

            const fileStream = fs.createWriteStream(destPath);
            res.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close(resolve);
            });
            fileStream.on('error', (err) => {
                fs.unlink(destPath, () => reject(err));
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        // Set timeout to prevent hanging connections
        req.setTimeout(30000, () => {
            req.abort();
            reject(new Error(`Request timeout for ${url}`));
        });
    });
}

// Download with retries and exponential backoff
async function downloadWithRetry(url, destPath, attempt = 1) {
    try {
        await downloadFile(url, destPath);
        return true;
    } catch (err) {
        if (attempt <= MAX_RETRIES) {
            const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            console.log(`      [Retry] Attempt ${attempt} failed for ${path.basename(destPath)}: ${err.message}. Retrying in ${delay}ms...`);
            await sleep(delay);
            return downloadWithRetry(url, destPath, attempt + 1);
        } else {
            console.error(`      [Error] Final failure downloading ${url}: ${err.message}`);
            return false;
        }
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
            const dataObj = Array.isArray(record) ? (record[0] === 2 ? record[1] : (record[0] === 3 ? record[2] : null)) : record;
            if (dataObj && dataObj.conversation_id && (dataObj.tweet_id || dataObj.id_str)) {
                const tId = dataObj.tweet_id || dataObj.id_str;
                if (!convoMap.has(dataObj.conversation_id)) convoMap.set(dataObj.conversation_id, new Set());
                convoMap.get(dataObj.conversation_id).add(tId);
            }
        }
        for (const [convoId, tweetIds] of convoMap.entries()) {
            if (tweetIds.size > 1) threadConvoIds.add(convoId);
        }
    }
    // -----------------------------

    // Filter media records based on CLI flags
    const mediaRecords = records.filter(record => {
        const dataObj = Array.isArray(record) ? (record[0] === 2 ? record[1] : (record[0] === 3 ? record[2] : null)) : record;
        
        if (IGNORE_THREADS && dataObj && dataObj.conversation_id && threadConvoIds.has(dataObj.conversation_id)) {
            return false; // Skip threads
        }

        const isMediaRecord = (Array.isArray(record) && record[0] === 3) || 
                              (record.type === 'photo' || record.type === 'video' || record.type === 'animated_gif');
        
        if (!isMediaRecord) return false;

        let type = null;
        let duration = null;

        if (Array.isArray(record)) {
            type = record[2] ? record[2].type : null;
            duration = record[2] ? record[2].duration : null;
        } else {
            type = record.type;
            duration = record.duration;
        }

        if (!type) {
             const url = Array.isArray(record) ? record[1] : (record.url || record.media_url);
             if (url && typeof url === 'string') {
                 if (url.includes('.mp4') || url.includes('video.twimg.com')) type = 'video';
                 else type = 'photo';
             }
        }

        const isVideo = type === 'video' || type === 'animated_gif';
        const isImage = type === 'photo';

        if (IGNORE_LARGE_VIDEOS && isVideo && duration !== null && duration !== undefined) {
            const durationSec = parseFloat(duration);
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
        
        // Extract media URL depending on structure
        let mediaUrl = null;
        let tweetId = null;
        let dateStr = '';

        if (Array.isArray(record)) {
            // gallery-dl format [3, mediaUrl, mediaData]
            mediaUrl = record[1];
            const mediaData = record[2] || {};
            tweetId = mediaData.tweet_id || mediaData.id_str || '';
            dateStr = mediaData.date || '';
        } else {
            // Object format
            tweetId = record.tweet_id || record.id_str;
            mediaUrl = record.url || record.media_url_https || record.media_url;
            dateStr = record.date || record.created_at || '';
        }

        if (!mediaUrl) continue;

        let formattedDate = '';
        if (dateStr) {
            // Handle formats like "YYYY-MM-DD HH:MM:SS" or ISO strings
            const firstPart = dateStr.split('T')[0].split(' ')[0];
            formattedDate = firstPart.replace(/-/g, '_') + '_';
        }

        // Upgrade image URL to high quality
        if (mediaUrl.includes('pbs.twimg.com/media/')) {
            const urlObj = new URL(mediaUrl);
            urlObj.searchParams.delete('name');
            urlObj.searchParams.set('name', 'orig');
            mediaUrl = urlObj.toString();
        }

        // Clean query strings to get a valid filename
        const cleanUrl = mediaUrl.split('?')[0];
        const ext = path.extname(cleanUrl) || '.jpg';
        
        // Construct filename incorporating date and tweet ID for tracking
        const localFileName = `${formattedDate}${tweetId}_${path.basename(cleanUrl, ext)}${ext}`;
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
        await sleep(500);
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
