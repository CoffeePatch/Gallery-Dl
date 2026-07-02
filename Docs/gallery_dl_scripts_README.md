# Media Downloader (X / Twitter)

This module is a focused wrapper around `gallery-dl` specifically designed to download media (photos and videos) from X (Twitter) accounts in batch mode.

## Files

- `archive.ps1`: The main batch runner. It reads handles/URLs and modes from `users.txt`, loops through them, and triggers `gallery-dl`.
- `config.json`: The specific `gallery-dl` configuration tailored for X.

## Features

- **Persistent Archives:** Uses a SQLite archive database (`Tweets/archive.sqlite3`) under the hood. This means you can re-run the script as often as you want, and it will strictly skip any tweets or media files you have already downloaded!
- **Organized Output:** By default, it automatically routes downloaded media into a centralized directory: `Tweets/<username>/`.
- **Markdown Index Logs:** Depending on the mode specified in `users.txt`, it can append a markdown snippet per Tweet into an author-scoped file (`Tweets/<username>/<username>_master_index.md`) mapping the tweet text to the downloaded media.

## Setup & Configuration

1. Install `gallery-dl` globally via Python:
   ```powershell
   pip install gallery-dl
   ```
2. Your targets should be placed in `users.txt` (located in the root directory). You can put raw usernames or full X URLs, followed by an optional pipe `|` and mode (`media` or `both`).
   Example:
   ```
   https://x.com/target | media
   target2 | both
   ```
3. If you want to download age-restricted or sensitive media, you should place a Netscape `cookies.txt` file in the root directory to authenticate the session.

## How to Run

From the root directory, you can run the batch process:

```powershell
.\Scripts\gallerydl_batch_scraper.ps1
```

### Execution Modes and Flags

The script supports three distinct modes. Understanding these flags is critical to how it interacts with the Twitter API and your existing downloaded data:

1. **Default Mode (No Flags):** 
   - **Command:** `.\Scripts\gallerydl_batch_scraper.ps1`
   - **Behavior:** The script reads the SQLite database to see what tweets you have already extracted. When it encounters known tweets, it will skip them. **Critically**, it will instantly `--abort` making API requests to Twitter once it sees 5 consecutive known tweets. This is the intended behavior for updating accounts you've previously scraped, as it saves massive amounts of time and rate limits.
   
2. **Skip Mode (`-Skip`):**
   - **Command:** `.\Scripts\gallerydl_batch_scraper.ps1 -Skip`
   - **Behavior:** Operates identical to Default Mode (aborts after 5 known tweets). *Note: In older versions, Default mode lacked the abort trigger, making this flag necessary. Default mode now natively includes the abort trigger to prevent API waste.*

3. **Overwrite Mode (`-Overwrite`):**
   - **Command:** `.\Scripts\gallerydl_batch_scraper.ps1 -Overwrite`
   - **Behavior:** **DANGEROUS.** This flag completely ignores your existing SQLite database and *deletes* the local JSON file for the target account. It forces a 100% fresh, complete extraction of the account's entire timeline from scratch. Use this only if your local data is corrupted and you need to completely redownload the account's metadata.

### Script Behavior
- **Automatic Paths:** The script dynamically resolves `users.txt` and `cookies.txt` from the parent directory.
- **Cookies & Authentication:** It will attempt to use `cookies.txt` in the root folder. If absent, it automatically falls back to your local Microsoft Edge browser cookies (`--cookies-from-browser edge`).
- **Rate Limit Protection:** It enforces a built-in randomized sleep request between actions to mitigate X API limits.
- **SQLite Archive Pre-population:** If you have existing JSON files from a previous run but *no* SQLite database files, you **must** run `.\Scripts\prepopulate_archives.ps1` first. Otherwise, the scraper will think you have zero existing tweets and will download the entire timeline again (wasting API requests).

## Under the Hood Workflow

1. The PowerShell script `archive.ps1` reads `users.txt` line by line from the root folder.
2. For each user, it cleans the handle (removing `www.`, protocols, or queries) and determines the desired download mode.
3. It spawns the `gallery-dl` executable, pointing it explicitly to `config.json` and injecting absolute paths to the `Tweets/` output folder. Postprocessors are toggled dynamically based on the target's mode.
4. `gallery-dl` parses the media timelines, checks `archive.sqlite3` to see if the Tweet ID is known, and if not, downloads the raw files.
5. If the mode is `both`, the postprocessor fires upon completion, writing an organized markdown log snippet to the user's directory.

---

## Detailed Technical Explanations

### How the `config.json` Actually Works

The config file is a JSON document that tells `gallery-dl` *how* to behave. It's structured hierarchically:

```json
{
  "extractor": {           
    "twitter": {            
      "retweets": true,     
      "text-tweets": true,  
      "directory": ["{user[name]}"],   
      "filename": "{tweet_id}_{num}.{extension}",    
      "postprocessors": [...] 
    }
  }
}
```

**Key flags and what they control:**

| Flag | Type | What It Does |
| --- | --- | --- |
| `"retweets"` | `bool` | Fetch media from Retweets. Set `true` to include them. |
| `"text-tweets"` | `bool` | Also emit metadata for text-only Tweets without media content. Only works if a `metadata` post-processor is enabled. |
| `"conversations"` | `bool` | Fetches thread/conversation context (which includes replies to the target user). Usually set to `false` unless you want the entire comment section. |
| `"replies"` | `bool` | Fetch media from replies to other Tweets. Set to `false` to avoid downloading comments. |
| `"directory"` | `list` | Path segments under the base directory. `["{user[name]}"]` creates a folder per handle. |
| `"filename"` | `string` | Template for downloaded file names. `{tweet_id}`, `{num}`, `{extension}` are replacement fields. |

### Post-Processors — What They Are and How They Work

**Post-processors** are actions `gallery-dl` performs *after* downloading (or encountering) a file/post. Think of them as hooks. They are the only mechanism `gallery-dl` provides to extract tweet text, build `.md` files, and create structured logs.

**The `metadata` post-processor configuration in this script:**

| Key | What It Does |
| --- | --- |
| `"name": "metadata"` | Identifies this as the metadata writer post-processor. |
| `"event": "post"` | Triggers once per **tweet** (not per media file). |
| `"open": "a"` | Append mode — crucial for building one `.md` file. Without it, each tweet overwrites the file. |
| `"mode": "custom"` | Lets you define a `"format"` string with placeholders (e.g., `{tweet_id}`, `{content}`). |
| `"filter"` | A Python expression. Only write metadata when this evaluates to `True`. Our filter (`retweet_id == 0 or author['name'] != user['name']`) prevents logging self-retweets. |

### Twitter Rate Limits When Scraping

Twitter's rate limits are imposed by Twitter/X's GraphQL API. 

- Twitter's GraphQL API endpoints each have their own rate limit windows, typically ~50 requests per 15-minute window for authenticated users.
- The downloader can trigger the rate limit even with the timeline option not included in the config. Once tripped, it can lock you out for a significant amount of time.
- **Protection mechanism:** The config uses `"sleep-request": "3.0-6.0"` to add a randomized delay between API calls to safely space them out.
- **Tip:** Process accounts one by one. A full timeline scrape of a heavy account (1000+ media items) can take hours due to enforced waits.

### What Can Actually Be Extracted? (Expectations)

**What you CAN reliably get:**
- All media tweets from the recent `/media` timeline (recent ~1000).
- Additional media via search fallback.
- Retweets, quoted tweets, pinned tweets.
- Text-only tweets (with `text-tweets: true`).

**What you CANNOT guarantee:**
- Very old tweets (Twitter's search index is incomplete and nothing can be done about that).
- Deleted tweets.
- Tweets from suspended/protected accounts.
- Listing all media filenames explicitly in the Markdown text. Media files are implicitly linked by the `{tweet_id}` naming convention (e.g., `12345_1.jpg`, `12345_2.jpg`).

---

## Local Post-Processing Scripts

In addition to the main downloader, this repository includes standalone Node.js scripts to process the raw JSON metadata collected by `gallery-dl`.

### 1. `generate_timeline.js`
This script takes the raw `.json` output from `gallery-dl` and generates a beautiful, traditional Twitter-like HTML timeline, completely offline. It injects user details, tweet text, engagement stats, and correctly embeds photos and videos inline.

**Usage:**
```powershell
# To process a single file:
node scripts/generate_timeline.js "TweetData/username_tweets.json"

# To batch process an entire directory (default input is ../TweetData):
node scripts/generate_timeline.js --batch
node scripts/generate_timeline.js --batch "C:\custom\path\TweetData"
```
*Outputs are saved to the `TimelineOutputs` folder by default in batch mode.*

### 2. `download_media.js`
Instead of using `gallery-dl`'s built-in file downloader, this is a custom concurrent media downloader. It reads the `[3, ...]` media records from your `.json` data files and downloads all photos and videos asynchronously. It's built to be robust, featuring automatic retries, exponential backoff, and skipping already-downloaded files to save bandwidth.

**Usage:**
```powershell
# Basic run with default parameters (downloads both images and videos)
node scripts/download_media.js

# Download only videos
node scripts/download_media.js --videos-only

# Download only images
node scripts/download_media.js -i

# Custom configuration
node scripts/download_media.js --concurrency 10 --input "TweetData" --output "CustomMediaFolder"

# Dry run (safely check what would be downloaded without actually downloading)
node scripts/download_media.js --dry-run
```

**Features:**
- **Concurrency:** Uses 5 parallel download workers by default (adjustable via `--concurrency` or `-c`).
- **Media Filtering:** Use `--videos-only` (or `-v`) or `--images-only` (or `-i`) to fetch specific media types.
- **Resumable:** Generates a `media_map.json` mapping URLs to local files, and automatically skips files that already exist on disk with a size > 0.
- **Organization & Sorting:** Automatically groups downloaded media into folders named after the source account. Files are prefixed with `YYYY_MM_DD_` so they automatically sort chronologically in your file explorer.

### 3. `filter_large_videos.js`
Filters video media records out of raw JSON files using a duration threshold. Instead of downloading files, it extracts matching metadata records and saves them into individual `[accountname]_Large.json` files.

**Usage:**
```powershell
# Default run (filters videos >= 30 seconds from TweetData/RawData and saves to TweetData/LargeRawData)
node scripts/filter_large_videos.js

# Filter videos LESS than 25 minutes from TweetData/NewRawData
node scripts/filter_large_videos.js -i TweetData/NewRawData -t 25m -l

# Filter videos GREATER than 25 minutes from TweetData/NewRawData
node scripts/filter_large_videos.js -i TweetData/NewRawData -t 25m
```

**Options & Flags:**
- `-i <path>` / `--input <path>`: Source folder containing raw JSON files (default: `TweetData/RawData`).
- `-o <path>` / `--output <path>`: Directory to save filtered JSON files (default: `TweetData/LargeRawData`).
- `-t <duration>` / `--threshold <duration>`: Duration threshold (supports units like `s` or `m`, e.g. `25m` or `30s`). Default is `30m`.
- `-l` / `--less-than`: Flag to select videos *less than* the threshold (if omitted, filters for videos *greater than or equal to* the threshold).

### 4. `generate_summary_stats.js`
Scans raw metadata JSON files and aggregates stats for each account (total tweets, retweets, original tweets, videos, images, and total records). It outputs a neat summary report in Markdown and/or CSV formats.

**Usage:**
```powershell
# Basic run (reads RawData/ and outputs both summary_stats.md and summary_stats.csv)
node scripts/generate_summary_stats.js

# Read from custom directory NewRawData/ and generate reports
node scripts/generate_summary_stats.js -i TweetData/NewRawData

# Generate ONLY a CSV report
node scripts/generate_summary_stats.js -f csv

# Generate a Markdown report to a specific custom location
node scripts/generate_summary_stats.js -o TweetData/Reports/scraped_accounts -f md
```

**Options & Flags:**
- `-i <dir>` / `--input <dir>`: Folder containing the raw JSON files (default: `TweetData/RawData`).
- `-o <path>` / `--output <path>`: Custom base file path for reports (default: `TweetData/summary_stats`).
- `-f <format>` / `--format <format>`: Output format choice (`md`, `csv`, or `both`). Default is `both`.

