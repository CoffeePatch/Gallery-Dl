# Media Downloader (`download_media.js`)

A highly robust, concurrency-enabled Node.js script designed to process raw JSON tweet data and automatically download all extracted media (images, videos, and GIFs).

## 🚀 Key Features

- **Concurrent Processing:** Uses a worker pool architecture to download multiple files simultaneously, dramatically speeding up bulk archival.
- **Smart Retries & Exponential Backoff:** Network failures are automatically retried up to 3 times with increasing delays to ensure maximum success rates.
- **Flawless Resumption:** Generates a real-time `_media_map.json` for every account. If the script is halted, running it again will instantly skip all previously downloaded media and resume exactly where it left off!
- **Bandwidth Limits (`--max-gb`)**: You can set a strict download size limit. Once the total downloaded media hits the limit (e.g., 20 GB), the script halts gracefully.
- **Advanced Exclusions:** By default, the script intelligently pre-processes the data to actively ignore media belonging to **Threads** and **Large Videos** (>= 30 seconds). These are managed by dedicated scripts elsewhere.
- **CLI Filtering:** Download only videos (`-v`) or only images (`-i`).

## 📁 Directory Structure

- **Input Data:** `TweetData/RawData/` - Contains the source `.json` files to parse.
- **Output Media:** `TweetData/Media/` - Downloaded files are organized into subfolders per account name.
- **Mapping Files:** `TweetData/Media/Mappings/` - Stores the tracking JSON maps for the resume functionality.

## 🖥️ How to Run

1. Navigate to the root of the project.
2. Run the script using Node.js:

```powershell
# Standard run (downloads all valid media)
node Scripts/download_media.js

# Stop gracefully after downloading 20 GB of media
node Scripts/download_media.js --max-gb 20

# Download only videos, stop after 5 GB
node Scripts/download_media.js -v --max-gb 5

# Override exclusions and download EVERYTHING (including threads and large videos)
node Scripts/download_media.js --include-threads --include-large-videos
```
