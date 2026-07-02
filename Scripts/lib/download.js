const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

        // Set timeout to prevent hanging connections (30 seconds)
        req.setTimeout(30000, () => {
            req.abort();
            reject(new Error(`Request timeout for ${url}`));
        });
    });
}

// Download with retries and exponential backoff
async function downloadWithRetry(url, destPath, options = {}) {
    const maxRetries = options.maxRetries !== undefined ? options.maxRetries : DEFAULT_MAX_RETRIES;
    const baseDelay = options.baseRetryDelayMs !== undefined ? options.baseRetryDelayMs : DEFAULT_BASE_RETRY_DELAY_MS;
    const attempt = options.attempt || 1;

    try {
        await downloadFile(url, destPath);
        return true;
    } catch (err) {
        if (attempt <= maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.log(`      [Retry] Attempt ${attempt} failed for ${path.basename(destPath)}: ${err.message}. Retrying in ${delay}ms...`);
            await sleep(delay);
            return downloadWithRetry(url, destPath, {
                maxRetries,
                baseRetryDelayMs: baseDelay,
                attempt: attempt + 1
            });
        } else {
            console.error(`      [Error] Final failure downloading ${url}: ${err.message}`);
            return false;
        }
    }
}

function getNormalizedUrl(mediaUrl) {
    if (!mediaUrl) return '';
    let url = mediaUrl;
    if (url.includes('pbs.twimg.com/media/')) {
        try {
            const urlObj = new URL(url);
            urlObj.searchParams.delete('name');
            urlObj.searchParams.set('name', 'orig');
            url = urlObj.toString();
        } catch (e) {
            // ignore
        }
    }
    return url;
}

function constructFilename(mediaUrl, tweetId = '', dateStr = '') {
    let formattedDate = '';
    if (dateStr) {
        const firstPart = dateStr.split('T')[0].split(' ')[0];
        formattedDate = firstPart.replace(/-/g, '_') + '_';
    }
    const prefix = tweetId ? `${formattedDate}${tweetId}_` : formattedDate;
    const cleanUrl = mediaUrl.split('?')[0];
    const ext = path.extname(cleanUrl) || '.jpg';
    const base = path.basename(cleanUrl, ext);
    return `${prefix}${base}${ext}`;
}

module.exports = {
    downloadFile,
    downloadWithRetry,
    getNormalizedUrl,
    constructFilename
};
