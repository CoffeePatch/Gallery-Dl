# Thread Archiver User Guide

This guide shows a new user how to archive a thread with this repo in the simplest possible way.

## What This Tool Does

The thread archiver saves a thread as an offline HTML file in `TweetData/Threads/`. It also stores intermediate raw data in `TweetData/ThreadsRaw/` and keeps its archive state in `Config/Queues/archive_state.sqlite3`. The text queue files remain as optional human-readable logs.

## Supported URL Types

The archiver supports these thread URL formats:

- `https://x.com/<user>/status/<id>`
- `https://twitter.com/<user>/status/<id>`
- `https://threadreaderapp.com/thread/<id>`
- `https://threadreaderapp.com/user/<profile>`

Notes:

- X and Twitter thread URLs are handled as thread posts.
- ThreadReaderApp profile URLs are expanded into individual thread URLs automatically.
- ThreadReaderApp direct thread URLs are archived directly.

## Ways To Archive

There are three simple ways to use the archiver:

1. Archive one thread by passing a URL directly to the script.
2. Archive many threads by putting URLs into the single unified queue file and running the script once.
3. Archive a ThreadReaderApp profile by adding the profile URL and letting the script expand it into all thread links.

## Step By Step

### 1. Make sure the workspace is ready

Before you start, check that these files exist:

- `Config/Cookies/cookies.txt`
- `Config/Users/threads.txt`

If `cookies.txt` is missing or invalid, the X/Twitter thread flow will not work.

### 2. Choose how you want to add URLs

You can use any of these input methods:

- Put any supported thread URL in `Config/Users/threads.txt`
- Pass a single URL directly on the command line

Use one URL per line in the queue files.

### 3. Run the archiver

From the repository root, run:

```powershell
npm run threads
```

To archive a single URL directly, use:

```powershell
npm run threads -- "https://x.com/<user>/status/<id>"
```

You can replace the URL with any supported X, Twitter, or ThreadReaderApp thread URL.

### 4. Wait for processing to finish

The script will:

- read the unified queue file
- skip thread IDs already archived in SQLite
- expand ThreadReaderApp profile URLs into thread URLs
- try X/Twitter threads through the API first
- fall back to browser scraping when needed
- save the final offline HTML file

### 5. Check the results

When the run finishes, look in these places:

- `TweetData/Threads/` for completed HTML archives
- `Config/Queues/archive_state.sqlite3` for the primary archive state
- `Config/Queues/completed_threads.txt` for an optional success log
- `Config/Queues/failed_threads.txt` for an optional failure log

## Recommended First Run

For a new user, the easiest first test is:

1. Add one known thread URL to `Config/Users/threads.txt`
2. Run `npm run threads`
3. Confirm the HTML file appears in `TweetData/Threads/`

After that, you can move on to larger batches or ThreadReaderApp profile URLs.

## Quick Summary

- One-off run: pass a single URL to `npm run threads -- "<url>"`
- Queue run: add URLs to `Config/Users/threads.txt`, then run `npm run threads`
- ThreadReader profile run: add a `/user/` URL and let the script expand it automatically