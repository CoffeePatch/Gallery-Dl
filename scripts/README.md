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
.\scripts\archive.ps1
```

### Script Behavior
- **Automatic Paths:** The script dynamically resolves `users.txt` and `cookies.txt` from the parent directory.
- **Cookies & Authentication:** It will attempt to use `cookies.txt` in the root folder. If absent, it automatically falls back to your local Microsoft Edge browser cookies (`--cookies-from-browser edge`).
- **Rate Limit Protection:** It enforces a built-in randomized sleep request between actions to mitigate X API limits.

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
