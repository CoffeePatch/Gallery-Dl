# Media Downloader (X / Twitter)

This module is a focused wrapper around `gallery-dl` specifically designed to download media (photos and videos) from X (Twitter) accounts in batch mode.

## Files

- `auto.ps1`: The main batch runner. It reads handles/URLs from a text file, loops through them, and triggers `gallery-dl`.
- `config.json`: The specific `gallery-dl` configuration tailored for X.

## Features

- **Persistent Archives:** Uses a SQLite archive database (`archive.sqlite3`) under the hood. This means you can re-run the script as often as you want, and it will strictly skip any tweets or media files you have already downloaded!
- **Organized Output:** By default, it automatically routes downloaded media into a structured directory: `./Tweets/<username>/`.
- **HTML Logs:** Appends a small HTML snippet per Tweet into an author-scoped file (`./Tweets/<username>/<username>_tweets.html`) so you have a browseable visual history of what was downloaded.

## Setup & Configuration

1. Install `gallery-dl` globally via Python:
   ```powershell
   pip install gallery-dl
   ```
2. Your targets should be placed in `users.txt` (located in the root directory). You can put raw usernames or full X URLs (one per line).
3. If you want to download age-restricted or sensitive media, you should place a Netscape `cookies.txt` file in the root directory to authenticate the session.

## How to Run

From the root directory, you can run the batch process:

```powershell
.\media-downloader-x\auto.ps1 -UsersFile .\users.txt -ConfigPath .\media-downloader-x\config.json -CookiesPath .\cookies.txt
```

### Important Command Arguments
- `-SleepRequest 1`: Adds a 1-second delay between requests to help mitigate X rate limits.
- `-Proxy "socks5://127.0.0.1:1080"`: Routes traffic through a local proxy or VPN to bypass regional restrictions.
- `-User <username>`: Run the script for a single specific user instead of reading the entire text file.
- `-NoReplies`: Disables downloading media that the user posted as replies.
- `-IgnoreArchive`: Forces a fresh re-download, bypassing the SQLite database check.

## Under the Hood Workflow

1. The PowerShell script `auto.ps1` reads `users.txt` line by line.
2. For each user, it constructs two standard target endpoints:
   - `https://x.com/<username>/media`
   - `https://x.com/<username>/with_replies` (unless `-NoReplies` is passed).
3. It spawns the `gallery-dl` executable, pointing it explicitly to `config.json` via `--config`. This forces `gallery-dl` to ignore your system-wide config and strictly apply the logic defined in this module.
4. `gallery-dl` parses the media timelines, checks `archive.sqlite3` to see if the Tweet ID is known, and if not, downloads the raw MP4 or JPG files.
5. The postprocessor (defined in `config.json`) fires upon completion, writing a visual HTML log snippet to the user's directory.
