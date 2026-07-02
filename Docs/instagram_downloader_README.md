# Media Downloader (Instagram)

This module is a wrapper around `gallery-dl` built to fetch media from Instagram profiles. Because Instagram's API and scraper defenses are highly aggressive, this script relies on authenticated session cookies.

## Files

- `Scripts/instagram_auto.ps1`: The PowerShell batch runner. Reads targets from a file and runs `gallery-dl`.
- `Config/Settings/instagram_config.json`: The Instagram-specific configuration for `gallery-dl`.

## Features

- **Duplicate Prevention:** Uses a local SQLite archive database (`TweetData/Media/Instagram/archive.sqlite3`) so subsequent runs are lightning fast and never download the same file twice.
- **Structured Downloads:** Automatically deposits files into `TweetData/Media/Instagram/<username>/`.
- **Bandwidth Limits:** The config is pre-configured to skip downloading exceptionally large files depending on your configuration.

## Setup & Configuration

1. Install `gallery-dl`:
   ```powershell
   pip install gallery-dl
   ```
2. Your targets should be placed in `Config/Users/instagram_users.txt`. Format should be one full URL per line (e.g., `https://www.instagram.com/username/`).
3. **Session Cookies:** Place your exported Netscape format cookies in `Config/Cookies/cookies.txt` (Instagram and Twitter share this file location). Instagram heavily restricts anonymous access.

## How to Run

From the root workspace directory, run:

```powershell
.\Scripts\instagram_auto.ps1
```

## Under the Hood Workflow

1. The PowerShell runner reads `Config/Users/instagram_users.txt`.
2. It invokes `gallery-dl` using `--config Config/Settings/instagram_config.json`.
3. `gallery-dl` parses the provided Instagram URLs using the session tokens from `Config/Cookies/cookies.txt`.
4. It checks `TweetData/Media/Instagram/archive.sqlite3` to verify if the post ID has already been scraped.
5. Missing media is downloaded into the structured target directory.

