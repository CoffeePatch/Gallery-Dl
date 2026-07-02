# Account Status Checker (Playwright)

This module provides a robust, highly optimized Node.js automation script (implemented in [accountChecker.js](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/lib/accountChecker.js) and imported by [maintenance_manager.js](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/maintenance_manager.js)) using the Playwright framework to safely determine if X (Twitter) accounts are **Active**, **Suspended**, or **Does Not Exist**.

Because X heavily rate-limits direct API checks via `gallery-dl`, this headless browser workflow simulates a real user session to fetch account statuses securely and reliably.

## Features

- **Native Session Ingestion:** It automatically parses your Netscape `Config/Cookies/cookies.txt` file and injects it securely into the Playwright session. No manual login required.
- **Auto-Resume & Clean up:** The script reads `TweetData/AccountStatus/results.csv` on startup. If you interrupt the process, it will automatically skip successfully checked accounts and retry any network failures seamlessly.
- **Strict Rate-Limit Defenses:**
  - **Micro-Delay & Jitter:** Randomised pacing intervals between checks (configurable in [rateLimits.js](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/lib/rateLimits.js)).
  - **Macro-Batching:** Processes exactly 150 accounts per batch, then gracefully shuts down the browser and sleeps to reset X's server-side API rate limits (cooldown configured in [rateLimits.js](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/lib/rateLimits.js)).
- **Messy Data Parser:** Extracts clean usernames from dirty URLs (e.g., `https://x.com/user/status/123?lang=en`) and automatically filters out system paths (like `/search`, `/home`).

## Setup & Installation

1. Ensure you have [Node.js](https://nodejs.org) installed on your system.
2. Install the workspace dependencies in the root directory:
   ```powershell
   npm install
   ```
3. Prepare your input files:
   - Place your `users.txt` file (containing URLs or handles, one per line) in the `Config/Users/` directory.
   - Place your exported `cookies.txt` in the `Config/Cookies/` directory.

## How to Run

From the root workspace directory, run:

```powershell
# Run the scanner
npm run x-check

# Or directly:
node Scripts/maintenance_manager.js --x-check
```

### Authentication Generation:
If your cookies are expired or missing, you can generate `Config/Settings/auth.json` by running:

```powershell
# Generate auth state
npm run x-auth

# Or directly:
node Scripts/maintenance_manager.js --x-auth
```
*This launches a visible Google Chrome window to let you manually log in and generate the session state.*

## Under the Hood Workflow

1. **Initialization:** The script looks for `TweetData/AccountStatus/results.csv`. If it exists, it parses it to build a `completedHandles` set.
2. **Parsing:** It reads `Config/Users/users.txt`, extracts the handles using regex, and removes any duplicates or handles that are already in the `completedHandles` set.
3. **Session:** It looks for `Config/Settings/auth.json` or `Config/Cookies/cookies.txt`. If `cookies.txt` is found, it automatically converts the Netscape format into Playwright's JSON storage state.
4. **Execution:** It launches a headless Chromium instance using the session. It loops through the target handles, checking the DOM elements for "Account suspended", "This account doesn’t exist", or the post-count header.
5. **Teardown:** It saves the status to `TweetData/AccountStatus/results.csv` using an append-only operation. If it hits 150 checks, it drops the browser context and sleeps for 15 minutes to reset limits.

