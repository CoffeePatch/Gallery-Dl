# Gallery-Dl (website media downloader)

This repo is a small, focused wrapper around **gallery-dl** for downloading media directly from websites (Twitter/X included).

Core rules:

- All downloaded files go under `./Tweets/` (no absolute paths).
- By default, downloads go to `./Tweets/<username>/`.
- The download archive is used so reruns skip files you already have.

## Files

| File | Purpose |
| --- | --- |
| `auto.ps1` | Batch runner: reads `users.txt`, runs `gallery-dl` for each line, writes logs. |
| `config.json` | gallery-dl configuration (extractor + naming + metadata postprocessor). |
| `users.txt` | One URL/target per line (anything `gallery-dl` accepts). |
| `instagram_auto.ps1` | Instagram runner: reads `instagram_users.txt`, runs `gallery-dl` for each line, writes logs. |
| `instagram_config.json` | gallery-dl configuration for Instagram runs (base folder + archive + max filesize). |
| `instagram_users.txt` | One Instagram URL/target per line. |

## Requirements

- Windows PowerShell (built-in) or PowerShell 7
- `gallery-dl` installed and on PATH (`pip install gallery-dl`)

Notes:

- Some sites/videos may require extra tooling depending on extractor behavior (e.g., ffmpeg).
- Cookies are optional and should never be committed.

## Quick start

1) Put targets in `users.txt` (one per line). Example:

```txt
https://x.com/SomeUser
https://twitter.com/AnotherUser
```

2) (Optional) Export your browser cookies to `cookies.txt` in **Netscape cookies.txt** format.

Note: Twitter/X media timelines often require authenticated cookies. If you see errors like `AuthRequired` or repeated `No results`, create `cookies.txt` and re-run.

3) Run:

```powershell
.\auto.ps1
```

## Instagram quick start

1) Put Instagram targets in `instagram_users.txt` (one per line). Example:

```txt
https://www.instagram.com/<username>/
```

2) (Recommended) Export your browser cookies to `instagram_cookies.txt` in **Netscape cookies.txt** format.

Note: Instagram frequently blocks anonymous requests.

3) Run:

```powershell
.\instagram_auto.ps1
```

Output goes under:

```text
./Instagram/
```

and uses a download archive at:

```text
./Instagram/archive.sqlite3
```

so reruns skip already-downloaded files.

## Output layout (default)

By default, `auto.ps1` downloads into:

```text
./Tweets/<username>/...
```

Additionally, a per-author HTML-ish log file is appended while downloading:

```text
./Tweets/<username>/<username>_tweets.html
```

If you want the old “one folder per run” layout, use `-UseRunId`.

## `auto.ps1` parameters

```powershell
.\auto.ps1 -UsersFile .\users.txt -ConfigPath .\config.json -CookiesPath .\cookies.txt
```

Optional switches:

- `-UseRunId`: store runs under `./Tweets/<timestamp>/<username>/...`
- `-IgnoreArchive`: bypass the download archive for a one-off re-download

Behavior:

- Skips blank lines in `users.txt`
- Runs gallery-dl for each line, and writes to `./Tweets/gallerydl_run.log`
- Ignores any global/user gallery-dl config and loads the local `config.json` explicitly (so global settings like `twitter.download=false` won't disable downloads)

## `config.json` notes (supported keys only)

This config intentionally uses keys that are documented/supported by gallery-dl:

- `extractor.base-directory`: default `./Tweets` when you run gallery-dl manually
- `extractor.archive`: a persistent download archive at `./Tweets/archive.sqlite3` so reruns can skip already-downloaded items
- `extractor.twitter.directory`: puts Twitter files under a per-author folder
- `extractor.twitter.filename`: tweet filename template
- `downloader.filesize-max`: skips downloads larger than `200m`
- `postprocessors` → `metadata` with `event: "post"`, `mode: "custom"`, `open: "a"`: appends one HTML snippet per Tweet to an author-scoped file

## Security / git hygiene

- `cookies.txt` should contain real session tokens. Keep it local.
- `.gitignore` excludes `Tweets/`, `cookies.txt`, and logs.
