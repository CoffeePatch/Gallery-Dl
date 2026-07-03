# Media Downloader (X / Twitter)

This module is a focused wrapper around `gallery-dl` specifically designed to harvest metadata and download media (photos and videos) from X (Twitter) accounts in batch mode.

## Files

- `Scripts/gallerydl_batch_scraper.ps1`: The main batch runner. It reads handles/URLs from `Config/Users/users.txt` and triggers `gallery-dl` to capture metadata.
- `Config/Settings/config.json`: The specific `gallery-dl` configuration tailored for X.

## Features

- **Persistent Archives:** Uses per-user SQLite archive databases (`TweetData/AccountStatus/<username>_archive.sqlite3`) under the hood. This means you can re-run the script as often as you want, and it will strictly skip any tweets you have already downloaded/scraped!
- **Organized Output:** Metadata JSON files are stored in `TweetData/RawData/`, and downloaded media files are grouped by account name inside `TweetData/Media/<username>/`.
- **Markdown Index Logs:** Depending on the mode specified, it can append a markdown snippet per Tweet into an author-scoped file mapping the tweet text to the downloaded media.

## Setup & Configuration

1. Install `gallery-dl` globally via Python:
   ```powershell
   pip install gallery-dl
   ```
2. Your targets should be placed in `Config/Users/users.txt`. You can put raw usernames or full X URLs, one per line.
3. If you want to download age-restricted or sensitive media, you should place a Netscape `cookies.txt` file in `Config/Cookies/` to authenticate the session.

## How to Run

From the root directory, you can run the batch process using `npm`:

```powershell
npm run scrape
```

Or trigger the PowerShell script directly:
```powershell
.\Scripts\gallerydl_batch_scraper.ps1
```

### Execution Modes and Flags

The script supports three execution routes mapping to CLI switches:

1. **Default Mode (No Flags):** 
   - **Command:** `npm run scrape` or `.\Scripts\gallerydl_batch_scraper.ps1`
   - **Behavior:** The script reads the user's JSON data to see what tweets you have already extracted. When it encounters known tweets, it skips them. **Critically**, the Node.js merger (`json_merger.js`) will instantly abort the `gallery-dl` process once it sees 5 consecutive known tweets. This saves rate limits. (Note: this abort logic lives in the app layer, not via gallery-dl's native `--abort` flag).
   
2. **Skip Mode (`-Skip`):**
   - **Command:** `npm run scrape:skip` or `.\Scripts\gallerydl_batch_scraper.ps1 -Skip`
   - **Behavior:** Identical to Default Mode.
   
3. **Overwrite Mode (`-Overwrite`):**
   - **Command:** `npm run scrape:overwrite` or `.\Scripts\gallerydl_batch_scraper.ps1 -Overwrite`
   - **Behavior:** **DANGEROUS.** This flag completely ignores and deletes the user's existing SQLite archive and local JSON file, forcing a 100% fresh, complete extraction of the account's entire timeline. Use only if local data is corrupted.

### Script Behavior
- **Automatic Paths:** The script dynamically resolves `Config/Users/users.txt`, `Config/Cookies/cookies.txt`, and `Config/Settings/config.json`.
- **Cookies & Authentication:** It will attempt to use `cookies.txt` in the `Config/Cookies/` folder. If absent, it automatically falls back to your local Microsoft Edge browser cookies (`--cookies-from-browser edge`).
- **Rate Limit Protection:** It enforces a built-in randomized sleep request between actions to mitigate X API limits.
- **SQLite Archive Pre-population:** If you have existing JSON files from a previous run but *no* SQLite database files, you **must** run `.\Scripts\prepopulate_archives.ps1` first. Otherwise, the scraper will think you have zero existing tweets and will download the entire timeline again.

## Under the Hood Workflow

1. The PowerShell script `Scripts/gallerydl_batch_scraper.ps1` reads `Config/Users/users.txt` line by line.
2. For each user, it cleans the handle and determines the desired download mode.
3. It spawns the `gallery-dl` executable, pointing it explicitly to `Config/Settings/config.json` and injecting absolute paths to the `TweetData/` folders.
4. `gallery-dl` parses the media timelines, checks the respective SQLite database to see if the Tweet ID is known, and if not, dumps the raw data.
5. Upon completion, a Python helper (`Scripts/sync_archive.py`) syncs the raw JSON records back into the user's SQLite archive database.

---

## Local Post-Processing Scripts

In addition to the main downloader, this repository includes Node.js scripts to process the raw JSON metadata collected by `gallery-dl`.

### 1. `generate_timeline.js`
This script takes the raw `.json` output from `gallery-dl` and generates a beautiful, traditional Twitter-like HTML timeline, completely offline. It injects user details, tweet text, engagement stats, and correctly embeds photos and videos inline.

**Usage:**
```powershell
# Run via NPM (interactive or defaults):
npm run timeline

# To process a single file:
node Scripts/generate_timeline.js "TweetData/RawData/username_tweets.json"

# To batch process an entire directory (default input is TweetData/RawData):
node Scripts/generate_timeline.js --batch
node Scripts/generate_timeline.js --batch "C:\custom\path\TweetData"
```
*Outputs are saved to the `TimelineOutputs` folder by default.*

### 2. `download_media.js`
This is a custom concurrent media downloader. It reads the `[3, ...]` media records from your `.json` data files (under `TweetData/NewRawData/` or `TweetData/RawData/`) and downloads all photos and videos asynchronously. It features automatic retries, exponential backoff, and skipping already-downloaded files.

**Usage:**
```powershell
# Run via NPM:
npm run media

# Basic run with default parameters (downloads both images and videos)
node Scripts/download_media.js

# Download only videos
node Scripts/download_media.js --videos-only

# Download only images
node Scripts/download_media.js -i

# Custom configuration
node Scripts/download_media.js --concurrency 10 --max-gb 20
```

**Features:**
- **Concurrency:** Uses 5 parallel download workers by default.
- **Media Filtering:** Use `--videos-only` (or `-v`) or `--images-only` (or `-i`) to fetch specific media types.
- **Resumable:** Generates a mapping file inside `TweetData/Media/Mappings/` mapping URLs to local files, and automatically skips files that already exist on disk with a size > 0.
- **Organization & Sorting:** Automatically groups downloaded media into folders named after the source account. Files are prefixed with `YYYY_MM_DD_` so they automatically sort chronologically in your file explorer.

### 3. Modular Maintenance Subscripts (`Scripts/lib/`)
The interactive command line interface in `Scripts/maintenance_manager.js` orchestrates several modularized sub-processes loaded from [Scripts/lib/](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/lib/):

- **Large Video Filter (`lib/videoFilter.js`)**:
  Filters video media records out of raw JSON files using a duration threshold. Extracts matching metadata records and saves them into individual `[accountname]_tweets_Large.json` files in `TweetData/LargeRawData/`.
  - **Usage**: `npm run filter-large` or `node Scripts/maintenance_manager.js --filter-large` (Default threshold: videos >= 30 mins / 1800s).
- **Summary Stats (`lib/stats.js`)**:
  Scans raw metadata JSON files in `TweetData/RawData/` and aggregates stats for each account (total tweets, retweets, original tweets, videos, images, and total records). Outputs summary reports in Markdown (`TweetData/summary_stats.md`) and CSV (`TweetData/summary_stats.csv`) formats.
  - **Usage**: `npm run stats` or `node Scripts/maintenance_manager.js --stats`.
- **Thread Separator (`lib/threadSeparator.js`)**:
  Identifies and isolates threaded conversations from flat timeline datasets, depositing them into `TweetData/Threads/`.
  - **Usage**: `npm run separate-threads` or `node Scripts/maintenance_manager.js --separate-threads`.
- **Self-Retweets Cleaner (`lib/retweetCleaner.js`)**:
  Scrubs and deletes self-retweet instances to deduplicate media sets.
  - **Usage**: `npm run clean-retweets` or `node Scripts/maintenance_manager.js --clean-retweets`.
- **Account Status Checker (`lib/accountChecker.js`)**:
  Integrates Playwright automation to check if handles are active/suspended/non-existent.
  - **Usage**: `npm run x-check` or `node Scripts/maintenance_manager.js --x-check`.
