# Gallery-Dl


---

## Config

```json
{
  "extractor": {
    "twitter": {
      "text-tweets": true,
      "download": true,
      "retweets": true,
      "include-retweet-media": true
    }
  },
  "output": {
    "directory": "C:/Users/hello/Pictures/HAS HOT/gallery-dl/twitter",
    "filename": "{author[name]}/{tweet_id}_{author[name]}_{date|strftime('%Y-%m-%d_%H-%M-%S')}.{extension}",
    "size": "<200m"
  },
  "postprocessors": [
    {
      "name": "metadata",
      "mode": "custom",
      "filename": "{extractor:username}_tweets.html",
      "open": "a",
      "content-format": "<h2>ID: {tweet_id}</h2><hr><h3>{content}</h3><p>Username: {author[name]}</p><p>Date: {date}</p><br><br>"
    }
  ]
}

```

## Script

auto.sh

```bash
# This script is a direct equivalent of your working bash script.

Write-Host "Starting tweet download at $(Get-Date)..."

# Check if users.txt exists
if (-not (Test-Path ".\\users.txt")) {
    Write-Host "Error: users.txt not found!"
    exit 1
}

# Check if users.txt is empty
if ((Get-Item ".\\users.txt").Length -eq 0) {
    Write-Host "Error: users.txt is empty!"
    exit 1
}

Write-Host "Reading users from users.txt..."

# Loop through each user in the file
foreach ($user in (Get-Content ".\\users.txt")) {
    # Skip any empty lines in the file
    if ($user -and $user.Trim() -ne "") {
        Write-Host ""
        Write-Host "Attempting to process user: $user"

        # Run gallery-dl and show its full output directly
        gallery-dl --config ".\\config.json" --cookies ".\\cookies.txt" $user

        # Check if the last command was successful (exit code 0)
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Successfully processed $user"
        } else {
            Write-Host "Skipped $user due to an error"
        }
    }
}

Write-Host ""
Write-Host "Download process completed at $(Get-Date)."

```

# Termux

## Config

```json
{
  "extractor": {
    "twitter": {
      "text-tweets": true,
      "download": true,
      "retweets": true,
      "include-retweet-media": true
    }
  },
  "output": {
    "directory": "/sdcard/Pictures/gallery-dl/Tweets/{author[name]}",
    "filename": "{tweet_id}_{author[name]}_{date|strftime(%Y-%m-%d_%H-%M-%S)}.{extension}",
    "size": "<200m"
  },
  "postprocessors": [
    {
      "name": "html",
      "filename": "/sdcard/Pictures/gallery-dl/Tweets/{extractor:username}_tweets.html",
      "open": "a",
      "content-format": "<h2>ID: {tweet_id}</h2><hr><h3>{content}</h3><p>Username: {author[name]}</p><p>Date: {date}</p><br>"
    }
  ]
}
```

```jsx
{
  "extractor": {
    "twitter": {
      "text-tweets": true,
      "download": false
    }
  },
  "output": {
    "directory": "/sdcard/gallery-dl-output/twitter/{author[name]}",
    "filename": "{author[name]}_{date|strftime(%Y-%m-%d_%H-%M-%S)}.{extension}"
  },
  "postprocessors": [
    {
      "name": "metadata",
      "event": "post",
      "mode": "custom",
      "filename": "/sdcard/gallery-dl-output/{extractor:username}_tweets.html",
      "open": "a",
      "content-format": "<h2>ID: {tweet_id}</h2><hr><hr><h3>{content}</h3><hr><hr><p>Username: {author[name]}</p><p>Date: {date}</p><br><br>"
    }
  ]
}
```

Desktop

```jsx
{
  "extractor": {
    "twitter": {
      "text-tweets": true,
      "download": true,
      "retweets": true,
      "include-retweet-media": true
    }
  },
  "output": {
    "directory": "C:\\Users\\hello\\Pictures\\HAS HOT\\gallery-dl\\twitter\\{author[name]}",
    "filename": "{author[name]}_{date|strftime(%Y-%m-%d_%H-%M-%S)}.{extension}",
    "size": "<200m"
  },
  "postprocessors": [
    {
      "name": "html",
      "filename": "C:\\Users\\hello\\Pictures\\HAS HOT\\gallery-dl\\twitter\\{extractor:username}_tweets.html",
      "open": "a",
      "content-format": "<h2>ID: {tweet_id}</h2><hr><hr><h3>{content}</h3><hr><hr><p>Username: {author[name]}</p><p>Date: {date}</p><br><br>"
    }
  ]
}

```

## Script

auto.sh

```bash
#!/data/data/com.termux/files/usr/bin/bash

echo "Starting tweet download at $(date)..."
if [ ! -f "users.txt" ]; then
echo "Error: users.txt not found!"
exit 1
fi
if [ ! -s "users.txt" ]; then
echo "Error: users.txt is empty!"
exit 1
fi
echo "Reading users from users.txt..."
while IFS= read -r user || [ -n "$user" ]; do
[ -z "$user" ] && continue
echo "Attempting to process user: $user"
if gallery-dl --config config.json --cookies cookies.txt "$user"; then
echo "Successfully processed $user"
else
echo "Skipped $user due to an error"
fi
done < users.txt
echo "Download process completed at $(date)."
```

## Commands

```bash
gallery-dl --config config.json --cookies cookies.txt -v "https://twitter.com/Lusty_th.jndisms"
```

```bash
bash auto.sh
```

```bash
.\auto.ps1
```

---

## Configuration File Structure

The configuration file is organized into three main sections:

- **Extractor**: Defines what content is downloaded from the website.
- **Output**: Controls where and how files are saved.
- **Postprocessors**: Processes data after downloading (e.g., creating HTML files).

---

## Extractor Section (Twitter)

The `"extractor"` section customizes how gallery-dl fetches content from Twitter.

### Properties

- **`text-tweets`**: Downloads text-only tweets (no media).
    - **Explanation**: Set to `true` to include tweets without images or videos.
    - **Example**: `"text-tweets": true`
- **`download`**: Enables downloading of media (images, videos).
    - **Explanation**: Set to `true` to save media files; `false` skips them.
    - **Example**: `"download": true`
- **`retweets`**: Includes retweets in the download.
    - **Explanation**: Set to `true` to fetch retweets along with original tweets.
    - **Example**: `"retweets": true`
- **`include-retweet-media`**: Downloads media from retweets.
    - **Explanation**: Ensures media in retweets is saved when `retweets` is `true`.
    - **Example**: `"include-retweet-media": true`

### Example

```json
"extractor": {
  "twitter": {
    "text-tweets": true,
    "download": true,
    "retweets": true,
    "include-retweet-media": true
  }
}

```

- **What it does**: Downloads all tweets (text-only, original, and retweets) with their media.

---

## Output Section

The `"output"` section determines where files are saved and how they’re named.

### Properties

- **`directory`**: Sets the folder for saving files.
    - **Explanation**: Use placeholders like `{author[name]}` to create subfolders based on the tweet author’s username.
    - **Example**: `"directory": "/sdcard/Pictures/gallery-dl/Tweets/{author[name]}"`
- **`filename`**: Defines the file naming pattern.
    - **Explanation**: Use placeholders like `{tweet_id}`, `{author[name]}`, and `{date}` (formatted with `strftime`).
    - **Example**: `"filename": "{tweet_id}_{author[name]}_{date|strftime(%Y-%m-%d_%H-%M-%S)}.{extension}"`
- **`size`**: Filters files by size.
    - **Explanation**: Use `"<200m"` to skip files larger than 200MB; adjust as needed (e.g., `"<500m"`).
    - **Example**: `"size": "<200m"`

### Example

```json
"output": {
  "directory": "/sdcard/Pictures/gallery-dl/Tweets/{author[name]}",
  "filename": "{tweet_id}_{author[name]}_{date|strftime(%Y-%m-%d_%H-%M-%S)}.{extension}",
  "size": "<200m"
}

```

- **What it does**: Saves files in author-specific folders with names like `123456789_user_2024-07-07_11-37-00.jpg`, skipping files over 200MB.

---

## Postprocessors Section

The `"postprocessors"` section processes downloaded data, such as generating HTML files or exporting metadata.

### Properties

- **`name`**: Specifies the postprocessor type.
    - **Explanation**: Use `"html"` for formatted HTML output or `"metadata"` for raw data.
    - **Example**: `"name": "html"`
- **`filename`**: Sets the output file’s path and name.
    - **Explanation**: Use `{extractor:username}` to name the file after the Twitter username.
    - **Example**: `"filename": "/sdcard/Pictures/gallery-dl/Tweets/{extractor:username}_tweets.html"`
- **`open`**: Controls how the file is written.
    - **Explanation**: `"a"` appends to the file; `"w"` overwrites it.
    - **Example**: `"open": "a"`
- **`content-format`**: Defines the output structure.
    - **Explanation**: Use HTML tags for `"html"` or plain text for `"metadata"`.
    - **Example (for HTML)**:
        
        ```json
        "content-format": "<h2>ID: {tweet_id}</h2><hr><h3>{content}</h3><p>Username: {author[name]}</p><p>Date: {date}</p><br>"
        
        ```
        

### Example (HTML Postprocessor)

```json
"postprocessors": [
  {
    "name": "html",
    "filename": "/sdcard/Pictures/gallery-dl/Tweets/{extractor:username}_tweets.html",
    "open": "a",
    "content-format": "<h2>ID: {tweet_id}</h2><hr><h3>{content}</h3><p>Username: {author[name]}</p><p>Date: {date}</p><br>"
  }
]

```

- **What it does**: Creates an HTML file (e.g., `username_tweets.html`) with tweet details formatted as headings and paragraphs.

---

## Filtering by Date

You can limit downloads to a specific date range using the `--filter` option with a Python expression.

### How to Use

- Add `-filter` to your command with a condition based on the `date` field (a `datetime` object).
- **Example**: Download tweets from January 30, 2024, to May 29, 2024:
    
    ```bash
    gallery-dl --filter "datetime(2024, 1, 30) <= date < datetime(2024, 5, 30)" "<https://twitter.com/username>"
    
    ```
    

### Notes

- Requires Python’s `datetime` module syntax.
- Useful for archiving tweets from a specific period.

---

## Resuming Downloads with Cursor

If a download stops (e.g., due to "No space left on device"), use the `cursor` value to resume.

### How It Works

- Gallery-dl provides a `cursor` in the terminal when interrupted.
- Pass it back using the `o cursor=` option to continue from the last tweet.

### Example

If the terminal shows:

```
[twitter][info] Use '-o cursor=1/DAAHCgABGuus_5E__-sLAAIAAAATMTkzNjI3NjQwMjA5NTI0MzU1MwgAAwAAAAIAAA' to continue downloading from the current position

```

Resume with:

```bash
gallery-dl --config config.json --cookies cookies.txt -o cursor=1/DAAHCgABGuus_5E__-sLAAIAAAATMTkzNjI3NjQwMjA5NTI0MzU1MwgAAwAAAAIAAA "<https://twitter.com/username>"

```

### Notes

- The `cursor` is unique to the user and session.
- Without a `cursor`, gallery-dl skips already downloaded files but may take longer to re-fetch the tweet list.

---

```json
{
  "extractor": {
    "twitter": {
      // --- CORE FUNCTIONALITY ---
      // These settings enable the download of all tweet types, including
      // text-only tweets and retweets with their associated media.
      "text-tweets": true,
      "download": true,
      "retweets": true,
      "include-retweet-media": true,

      // --- SOLUTION: SELF-RETWEET FILTER ---
      // This filter prevents the download of self-retweets. It checks if an item
      // is a retweet (retweet_id exists) AND if the original author is the same
      // as the user being scraped. The 'not' inverts this, so only items that
      // are NOT self-retweets are downloaded.[span_37](start_span)[span_37](end_span)[span_38](start_span)[span_38](end_span)
      "filter": "not (retweet_id and author['name'] == user['name'])",

      // --- BEST PRACTICE: AUTHENTICATION ---
      // It is highly recommended to use cookie-based authentication. It is more
      // reliable than username/password and is required for accessing protected
      // or NSFW content. Use a browser extension to export your twitter.com
      // cookies to a 'cookies.txt' file and place it in the gallery-dl config
      // directory.[span_39](start_span)[span_39](end_span)[span_40](start_span)[span_40](end_span) Uncomment the line below to use it.
      // "cookies": "C:/Users/hello/AppData/Roaming/gallery-dl/cookies.txt",

      // --- BEST PRACTICE: COMPREHENSIVE DOWNLOAD ---
      // When running gallery-dl, use the base URL (e.g., https://twitter.com/USERNAME)
      // instead of the '/media' URL. The '/media' endpoint is limited and may not
      // retrieve all historical media from an account.[span_41](start_span)[span_41](end_span)
    }
  },
  "output": {
    // The directory where all downloaded files will be saved.
    "directory": "C:/Users/hello/Pictures/HAS HOT/gallery-dl/twitter",

    // Defines the filename structure for each downloaded file.
    "filename": "{author[name]}/{tweet_id}_{author[name]}_{date|strftime('%Y-%m-%d_%H-%M-%S')}.{extension}",

    // A size filter to avoid downloading excessively large files.
    "size": "<200m"
  },
  "postprocessors":
      "name": "metadata",
      "mode": "custom",
      "filename": "{extractor:username}_tweets.html",
      "open": "a",
      "content-format": "<h2>ID: {tweet_id}</h2><hr><h3>{content}</h3><p>Username: {author[name]}</p><p>Date: {date}</p><br><br>"
    }
  ]
}

```
