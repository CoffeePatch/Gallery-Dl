# X (Twitter) Web GraphQL API Limits & Scraping Guidelines

> [!WARNING]
> Because X removed the free tiers from its official Developer REST API v2, scrapers like `gallery-dl` and `twscrape` bypass the official developer API. They mimic a desktop web browser and tap directly into Twitter’s internal Web GraphQL API endpoints. 
> 
> **These endpoints are undocumented, aggressively monitored by X's anti-bot systems, and subject to strict IP and cookie-level rate limits.**

## 1. GraphQL Endpoint Rate Limits

When tools parse the internal GraphQL endpoints (like `/tweet` or `/timeline`), the restrictions are strictly enforced per authenticated session cookie and IP address.

### The Single Tweet Limit (`TweetDetail` / `TweetResultByRestId`)
- **Limit:** ~150 requests per 15 minutes.
- **What it does:** Retrieves a specific single tweet by its structural ID. This is used heavily when downloading media from specific tweet URLs.
- **Trigger Risk:** If you target specific single tweet URLs to rip media, X will throw a `429 Too Many Requests` (or `local_rate_limited`) error if you pull more than 150 unique URLs in that quarter-hour window.

### The User Timeline Limit (`UserTweets` / `UserTweetsAndReplies`)
- **Limit:** ~50 requests per 15 minutes.
- **What it does:** Retrieves the feed of a target user.
- **Batch Size Constraint:** Up to 20 tweets per cursor page. One single request counts against your 50-request allotment but yields a maximum payload of roughly 20 items.

### The Search & Filter Limit (`SearchTimeline`)
- **Limit:** ~50 requests per 15 minutes.
- **What it does:** Executes searches across the global index.
- **Trigger Risk:** If you use search queries to filter match criteria, the internal search query layer is heavily guarded to prevent mass scraping.

---

## 2. Hard Database Limits (The 800 and 3,200 Caps)

The 800 and 3,200 figures are legendary hard caps built directly into Twitter’s backend database architecture. They dictate how far back a scraper can physically scroll through history.

### The 800 Limit (Secondary Timeline Cap)
If you try to scrape an account using a secondary or filtered timeline (like `User Mentions`, `Likes`, or excluding replies), X optimizes its server rendering by cutting the pagination stream off after exactly 800 tweets. No matter how many cursor pages you request past 800, the data payload returned drops to zero.

### The 3,200 Limit (Master Profile Cap)
This is the global master limit for a standard public profile feed. X's database only allows standard queries to go back 3,200 of the most recent tweets. If an account has posted 10,000 tweets, scrolling down their profile will physically stop loading new content once you hit the 3,200th tweet.

> [!TIP]
> **How to bypass the 3,200 limit:** 
> X's Global Search Index is un-capped and can search back to 2006. To bypass the profile barrier, use advanced search strings natively via `gallery-dl` instead of hitting the profile URL.
> 
> Example: `gallery-dl "https://x.com/search?q=from:username until:2024-01-01 since:2023-01-01&f=live"`

---

## 3. Media & CDN Limits (pbs.twimg.com / video.twimg.com)

While the GraphQL API governs how fast you can find and list tweets, the actual image and video files are served through X's Content Delivery Networks (CDNs): `pbs.twimg.com` (images) and `video.twimg.com` (videos). 

These CDN endpoints have their own strict rate-limiting layers independent of your session cookie:

### 🌟 Core CDN Limitations & Rules

- **No Authentication Needed:** The `://twimg.com` domain does not require headers, API keys, or cookies to download images.
- **Connection Throttling:** The main risk is making too many parallel connections from a single IP. If you open hundreds of concurrent downloads, the server will block requests with `429 Too Many Requests` or `ConnectionResetError` (usually resulting in a 10-15 minute IP block).
- **Connection Drops:** Aggressive downloading can also result in dropped streams during video processing.
- **Resolution Rule:** Twitter CDN URLs usually end with a format modifier like `?format=jpg&name=large` or `?format=png&name=orig`. Always ensure your URLs end with `name=orig` if you want the maximum uncompressed image quality.

> [!TIP]
> **How to avoid CDN limits:**
> Do not use aggressive multi-threading. Keep your download concurrency low (e.g. 5-10 simultaneous downloads) and ensure your `sleep-request` settings are active so the scraper has time to breathe between fetching media files.

### 🛠️ Safe Execution: The Right Tooling

To download thousands of URLs without breaking the CDN thresholds, you must use a tool that limits concurrency (how many files download at once) and implements a delay between batches.

#### Option 1: Python Script (Recommended for Developers)
Using an asynchronous loop with a semaphore is the safest way to control speed. Keep your concurrency at 5–10 simultaneous downloads.

#### Option 2: Linux/Mac Terminal (wget / curl)
If you have a plain text file (`urls.txt`) containing one URL per line, use `wget`. The `--limit-rate` and `--wait` flags are vital to bypass CDN detection.

```bash
wget -i urls.txt --wait=0.5 --random-wait --limit-rate=500k -P ./download_folder/
```

- `--wait=0.5`: Pauses for half a second between images.
- `--random-wait`: Randomizes the pause duration so it looks like human behavior.

---

## 4. Comparison: Web GraphQL vs. Official REST API v2

| Metric / Feature | Internal GraphQL API (Web Layout) | Official X REST API v2 (Basic Plan) |
|---|---|---|
| **Tweet Lookup Limit** | 150 requests per 15 mins | 900 requests per 15 mins |
| **User Timeline Limit** | 50 requests per 15 mins | 900 requests per 15 mins |
| **Monthly Read Cap** | None (bounded by 15-min windows) | 10,000 tweets per month ($100/mo tier) |
| **Batch Size** | Up to 20 tweets per cursor page | Up to 100 tweets per payload |
| **Authentication** | Requires browser `auth_token` cookies | Requires official Bearer Token |
| **Ban Risk** | **High** (automated use flags accounts) | Low (fully sanctioned ecosystem) |

---

## 5. Best Practices for Safe Scraping (Avoiding Bans)

To maximize throughput without hitting a `429 Too Many Requests` block or triggering account locks, implement these strategies when configuring `gallery-dl` or custom bots:

### 1. Enforce a Request Delay (Crucial)
Space single queries out with a mandatory sleep window. An artificial delay of 1.5 to 3.0 seconds makes your traffic fingerprint look like a human scrolling down a screen.
In your `gallery-dl` config, ensure this is set:
```json
"extractor": {
    "twitter": {
        "sleep-request": "1.5-3.0"
    }
}
```

### 2. Disable Token Caching (If Rate Limited Frequently)
`gallery-dl` attempts to reuse cached guest or session tokens. If you keep hitting limits, stop it from reusing old tokens by overriding the configuration:
```json
"cache": {
    "file": false
}
```

### 3. Rotate Multiple Accounts
If your workflow involves massive historical scraping, distribute operations across an active pool of authenticated accounts.

### 4. Break Large Queries into Time Windows
When bypassing the 3,200 limit via the Search endpoint, do not attempt to query 10 years of history at once. Break your requests into smaller, bite-sized date windows (e.g., month-by-month chunks). This prevents the scraper from choking on massive data streams and triggering anti-bot protections.

### 5. Monitor Live HTTP Headers
If you need to observe your real-time consumption limits, you must use an API debugging proxy (like Charles Proxy or Fiddler) to view the outbound traffic and look for X's injected response headers:
- `x-rate-limit-limit`: Maximum allowed requests for that endpoint inside the 15-minute bucket.
- `x-rate-limit-remaining`: How many tokens your session has left before a 429 ban kicks in.
- `x-rate-limit-reset`: A Unix epoch timestamp showing exactly when your limit refreshes.
