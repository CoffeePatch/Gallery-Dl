# Account Status Checker (Playwright)

This module provides a robust, highly optimized Node.js automation script using the Playwright framework to safely determine if X (Twitter) accounts are **Active**, **Suspended**, or **Do Not Exist**.

Because X heavily rate-limits direct API checks via `gallery-dl`, this headless browser workflow simulates a real user session to fetch account statuses securely and reliably.

## Features

- **Native Session Ingestion:** It automatically parses your Netscape `cookies.txt` file and injects it securely into the Playwright session. No manual login required.
- **Auto-Resume & Clean up:** The script reads `results.csv` on startup. If you interrupt the process, it will automatically skip successfully checked accounts and retry any network failures seamlessly.
- **Strict Rate-Limit Defenses:**
  - **Micro-Delay:** Pauses for 3 to 6 seconds (randomized jitter) between checking each account.
  - **Macro-Batching:** Processes exactly 150 accounts per batch, then gracefully shuts down the browser and sleeps for 15 minutes to reset X's server-side API rate limits.
- **Messy Data Parser:** Extracts clean usernames from dirty URLs (e.g., `https://x.com/user/status/123?lang=en`) and automatically filters out system paths (like `/search`, `/home`).

## Setup & Installation

1. Ensure you have [Node.js](https://nodejs.org) installed on your system.
2. In this directory (`account-status-checker`), install the dependencies:
   ```powershell
   npm install
   ```
3. Prepare your input files:
   - Place your `users.txt` file (containing URLs or handles, one per line) in the **root** workspace directory (outside this folder).
   - Place your exported `cookies.txt` in the **root** workspace directory.

## How to Run

Navigate to this directory in your terminal and run:

```powershell
node x_checker.js --mode check
```

*(Note: The script is built to run from the root directory context, but you can trigger it from anywhere as long as `users.txt` and `cookies.txt` are provided).*

### Modes:
- `--mode check` (Default): Runs fully headless, parses cookies, and starts batching accounts.
- `--mode auth`: Launches a visible Google Chrome window to let you manually log in and generate an `auth.json` file if your cookies are expired.

## Under the Hood Workflow

1. **Initialization:** The script looks for `results.csv`. If it exists, it parses it to build a `completedHandles` set.
2. **Parsing:** It reads `users.txt`, extracts the handles using regex, and removes any duplicates or handles that are already in the `completedHandles` set.
3. **Session:** It looks for `auth.json` or `cookies.txt`. If `cookies.txt` is found, it automatically converts the tab-delimited Netscape format into Playwright's JSON storage state.
4. **Execution:** It launches a headless Chromium instance using the session. It loops through the target handles, checking the DOM elements for "Account suspended", "This account doesn’t exist", or the post-count header.
5. **Teardown:** It saves the status to `results.csv` (in the root directory) using an append-only operation to prevent data loss. If it hits 150 checks, it drops the browser context and sleeps for 15 minutes to stay under the radar.
