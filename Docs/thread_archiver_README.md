# Thread Archiver

A local automation pipeline built to systematically archive digital threads offline. It bypasses link rot and data loss by saving fully self-contained HTML files where all lazy-loaded images are preserved and encoded as Base64 text.

## 📁 Directory Structure

- **`scripts/native_x_thread_archiver.js`**: (Recommended) The main automation script driving the headless browser.
- **`urls_threadreader.txt`**: Input file for Thread Reader App URLs.
- **`urls_twitterthread.txt`**: Input file for Twitter Thread URLs (fallback).
- **`completed.txt`**: Auto-generated tracking file for successfully processed URLs.
- **`failed.txt`**: Auto-generated tracking file logging failed URLs for review or re-processing.
- **`output/`**: Directory where all saved, self-contained HTML archives are generated.
- **`package.json` / `node_modules/`**: Node.js project metadata and installed dependencies.

## ⚙️ How the Workflow Works (Step-by-Step Map)

1. **Initialization:** The script reads `urls_threadreader.txt` and `urls_twitterthread.txt` and filters out any URLs already present in `completed.txt` to prevent duplicate processing.
2. **Launch:** A stealth Puppeteer headless browser is launched to evade Cloudflare and other bot detections.
3. **Navigation & Setup:** For each URL, a new tab opens and the viewport is set to 1920x1080 to ensure maximum quality assets are requested.
4. **Unroll Detection:** The script checks for and clicks any "Unroll" or "Read full thread" buttons to expand the page.
5. **Lazy Loading:** A paced scrolling function is executed, scrolling smoothly in 500px increments to trigger `IntersectionObserver` elements and ensure all lazy-loaded images fetch properly.
6. **Network Settlement:** The script waits for `networkidle0` (zero active connections) to ensure CDNs have fully downloaded the assets.
7. **Serialization:** `single-file-core` is dynamically bundled and injected directly into the live page context to serialize the rendered DOM.
8. **Validation & Save:** The HTML is verified for file size and the presence of Base64 strings. It is then saved as a single self-contained `.html` file inside the `output/` folder using the thread ID as the filename.
9. **Resilience & Safety:** Temporary failures are retried once. Rate-limiting is avoided by inserting random 3-7s delays between requests, and memory leaks are prevented by restarting the browser instance every 50 URLs.

## 🚀 Setup Instructions

1. Ensure you have Node.js installed on your machine.
2. Navigate to this directory in your terminal:
   ```bash
   cd c:\Users\hello\Pictures\Gallery-Dl\thread-archiver
   ```
3. Install the required dependencies (if you haven't already):
   ```bash
   npm install
   ```

## 🖥️ How to Run

1. **Add URLs:** Open `urls_threadreader.txt` and/or `urls_twitterthread.txt` and paste the URLs you wish to archive (one URL per line).
2. **Execute:** Run the automation script:
   ```bash
   node scripts/native_x_thread_archiver.js
   ```
3. **Monitor Progress:** The script will output its progress to the terminal, confirming saved files and noting any retries or errors.
4. **Review Results:** Once finished, open the `output/` folder to view your fully offline archives. Any URLs that ultimately failed will be neatly listed in `failed.txt`.
