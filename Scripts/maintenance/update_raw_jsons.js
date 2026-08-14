const fs = require('fs');
const path = require('path');
const { parseCookies, getApiCredentials } = require('../lib/api');
const { THREADS_OUTPUT_DIR, THREADS_RAW_DIR, COOKIES_FILE, GRAPHQL_PAYLOAD_CONFIG } = require('../lib/paths');

async function fetchThread(threadId, headers, queryId, payloadConfig, url) {
    const params = new URLSearchParams({
        variables: JSON.stringify({
            focalTweetId: threadId,
            ...payloadConfig.variables
        }),
        features: JSON.stringify(payloadConfig.features)
    });
    
    if (payloadConfig.fieldToggles) {
        params.append('fieldToggles', JSON.stringify(payloadConfig.fieldToggles));
    }
    
    console.log(`Fetching JSON for thread ${threadId}...`);
    try {
        const res = await fetch(url + '?' + params.toString(), { headers, signal: AbortSignal.timeout(20000) });
        if (!res.ok) {
            console.error(`Failed to fetch ${threadId}: HTTP ${res.status}`);
            return;
        }
        const data = await res.json();
        
        if (!fs.existsSync(THREADS_RAW_DIR)) {
            fs.mkdirSync(THREADS_RAW_DIR, { recursive: true });
        }
        
        const outPath = path.join(THREADS_RAW_DIR, `${threadId}_thread.json`);
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
        console.log(`Saved updated JSON for ${threadId}`);
    } catch (err) {
        console.error(`Error fetching ${threadId}:`, err);
    }
}

async function main() {
    if (!fs.existsSync(COOKIES_FILE)) {
        console.error(`Error: Cookies file missing at ${COOKIES_FILE}`);
        process.exit(1);
    }
    const cookieText = fs.readFileSync(COOKIES_FILE, 'utf-8');
    const cookieObj = parseCookies(cookieText);
    const ct0 = cookieObj['ct0'];
    if (!ct0) {
        console.error("Error: CSRF Token 'ct0' not found in cookies");
        process.exit(1);
    }
    const cookieString = Object.entries(cookieObj).map(([k, v]) => `${k}=${v}`).join('; ');
    const { queryId, bearerToken } = await getApiCredentials(cookieString);
    if (!bearerToken) {
        console.error("Error: Missing bearer token for Twitter GraphQL API");
        process.exit(1);
    }

    const payloadConfig = JSON.parse(fs.readFileSync(GRAPHQL_PAYLOAD_CONFIG, 'utf8'));
    const url = `https://x.com/i/api/graphql/${queryId}/TweetDetail`;
    const headers = {
        'authorization': `Bearer ${bearerToken}`,
        'x-csrf-token': ct0,
        'cookie': cookieString,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': 'en'
    };

    if (!fs.existsSync(THREADS_OUTPUT_DIR)) {
        console.log("No Threads directory found.");
        return;
    }

    const files = fs.readdirSync(THREADS_OUTPUT_DIR);
    const threadIds = [];
    
    for (const file of files) {
        if (file.endsWith('_thread.html')) {
            const threadId = file.split('_thread.html')[0];
            threadIds.push(threadId);
        }
    }
    
    console.log(`Found ${threadIds.length} threads to update.`);
    for (let i = 0; i < threadIds.length; i++) {
        await fetchThread(threadIds[i], headers, queryId, payloadConfig, url);
        await new Promise(r => setTimeout(r, 1000));
    }
    console.log('All threads updated!');
}

main().catch(console.error);
