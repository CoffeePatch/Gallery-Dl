# Media Downloader (Instagram)

This module is a wrapper around `gallery-dl` built to fetch media from Instagram profiles. Because Instagram's API and scraper defenses are highly aggressive, this script relies strictly on authenticated session cookies.

## Files

- `instagram_auto.ps1`: The PowerShell batch runner. Reads targets from a file and runs `gallery-dl`.
- `instagram_config.json`: The Instagram-specific configuration for `gallery-dl`.

## Features

- **Duplicate Prevention:** Uses a local SQLite archive database (`archive.sqlite3`) saved in the `./Instagram/` folder so subsequent runs are lightning fast and never download the same file twice.
- **Structured Downloads:** Automatically deposits files into `./Instagram/<username>/`.
- **Bandwidth Limits:** The config is pre-configured to skip downloading exceptionally large files (`filesize-max`) depending on your configuration.

## Setup & Configuration

1. Install `gallery-dl`:
   ```powershell
   pip install gallery-dl
   ```
2. Your targets should be placed in `instagram_users.txt` (located in the root directory). Format should be one full URL per line (e.g., `https://www.instagram.com/username/`).
3. **Mandatory:** You *must* place an `instagram_cookies.txt` file (in Netscape format) in the root directory. Instagram heavily restricts anonymous access.

## How to Run

From the root workspace directory, run:

```powershell
.\media-downloader-ig\instagram_auto.ps1 -UsersFile .\instagram_users.txt -ConfigPath .\media-downloader-ig\instagram_config.json -CookiesPath .\instagram_cookies.txt
```

## Under the Hood Workflow

1. The PowerShell runner reads `instagram_users.txt`.
2. It invokes `gallery-dl` using `--config instagram_config.json`.
3. `gallery-dl` parses the provided Instagram URLs using the injected session tokens from your `instagram_cookies.txt`.
4. It checks the `./Instagram/archive.sqlite3` database to verify if the post ID has already been scraped.
5. Missing media is downloaded into the structured `./Instagram/` target directory.
