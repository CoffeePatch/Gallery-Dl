# Thread Archiver

A local automation pipeline built to systematically archive digital threads offline. It bypasses link rot and data loss by saving fully self-contained HTML files where all lazy-loaded images are preserved and encoded as Base64 text.

## 📁 Directory Structure

All directory paths and queue files are configured centrally in [paths.js](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/lib/paths.js):
- **`Scripts/thread_manager.js`**: The consolidated script driving the thread archiving automation. It routes URLs internally by type, so one queue file is enough.
- **`Config/Users/threads.txt`**: Unified input queue file for all supported thread URLs.
- **`Config/Queues/completed_threads.txt`**: Auto-generated tracking file for successfully processed URLs.
- **`Config/Queues/failed_threads.txt`**: Auto-generated tracking file logging failed URLs for review.
- **`Config/Settings/graphql_api_payload.json`**: Externalised GraphQL request payload config (`variables`, `features`, and `fieldToggles`).
- **`TweetData/Threads/`**: Directory where all saved, self-contained HTML archives are generated.
- **`TweetData/ThreadsRaw/`**: Directory where intermediate raw JSON metadata dumps from X GraphQL endpoints are saved.
- **`package.json` / `node_modules/`**: Workspace Node.js metadata and dependencies.

## ⚙️ How the Workflow Works (Step-by-Step Map)

1. **Initialization:** The script reads `Config/Users/threads.txt` and filters out any URLs already present in `Config/Queues/completed_threads.txt` to prevent duplicate processing.
2. **Profile Expansion:** If a ThreadReaderApp `/user/` profile URL is detected, the script navigates to the profile, scrolls to load all threads, extracts the individual thread URLs, and injects them into the processing queue.
3. **API extraction (Twitter):** For X threads, it tries to fetch the conversation data using X's GraphQL API (authenticated via your cookie session, utilizing the query params defined in [graphql_api_payload.json](file:///c:/Users/hello/Pictures/Gallery-Dl/Config/Settings/graphql_api_payload.json)). If successful, it downloads all media files locally using [download.js](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/lib/download.js) and constructs a self-contained offline HTML page.
4. **Browser fallback (Twitter / ThreadReaderApp):** If the API limits are hit or for ThreadReaderApp, it spawns a headless browser, sets the viewport, performs paced scrolling to trigger lazy loading, and waits for CDN assets to finish fetching.
5. **Serialization:** `single-file-core` is dynamically bundled and injected to serialize the rendered DOM into a single self-contained `.html` file.
6. **Validation & Save:** The HTML is saved inside the `TweetData/Threads/` folder using the thread ID as the filename.

## 🚀 Setup Instructions

1. Ensure you have Node.js installed on your machine.
2. Open your terminal in the root workspace directory:
   ```bash
   cd c:\Users\hello\Pictures\Gallery-Dl
   ```
3. Install the required workspace dependencies:
   ```bash
   npm install
   ```

## 🖥️ How to Run

1. **Add URLs:** Open `Config/Users/threads.txt` and paste the URLs you wish to archive (one URL per line).
2. **Execute:** Run the automation script:
   ```bash
   npm run threads
   
   # Or directly:
   node Scripts/thread_manager.js
   ```
3. **Monitor Progress:** The script will output its progress to the terminal, confirming saved files and noting any retries or errors.
4. **Review Results:** Once finished, open the `TweetData/Threads/` folder to view your fully offline archives. Failed runs will be logged in `Config/Queues/failed_threads.txt`.
