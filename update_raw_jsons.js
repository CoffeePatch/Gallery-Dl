const fs = require('fs');
const path = require('path');

const TWEET_DATA_DIR = path.join(__dirname, 'TweetData');
const THREADS_DIR = path.join(TWEET_DATA_DIR, 'Threads');
const THREADS_RAW_DIR = path.join(TWEET_DATA_DIR, 'ThreadsRaw');

const cookies = fs.readFileSync(path.join(__dirname, 'Config', 'Cookies', 'cookies.txt'), 'utf8');
const auth = JSON.parse(fs.readFileSync(path.join(__dirname, 'Config', 'Settings', 'auth.json'), 'utf8'));
const payloadConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'Config', 'Settings', 'graphql_api_payload.json'), 'utf8'));
const queryId = auth.TweetDetailQueryId || '7_X_QxJ0Q-G_b8N9r_hQGQ';
const url = `https://x.com/i/api/graphql/${queryId}/TweetDetail`;

let cookieString = '';
if (cookies) {
    const lines = cookies.split('\n');
    const cookiePairs = [];
    for (const line of lines) {
        if (!line.startsWith('#') && line.trim() !== '') {
            const parts = line.split('\t');
            if (parts.length >= 7) {
                let name = parts[5].trim();
                let value = parts[6].trim().replace(/\r/g, '');
                if (name !== 'g_state' && !value.includes('\n')) {
                    cookiePairs.push(`${name}=${value}`);
                }
            }
        }
    }
    cookieString = cookiePairs.join('; ');
}

const headers = {
    'authorization': 'Bearer ' + auth.BearerToken,
    'x-csrf-token': auth.CsrfToken,
    'cookie': cookieString,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-language': 'en'
};

async function fetchThread(threadId) {
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
        const res = await fetch(url + '?' + params.toString(), { headers });
        if (!res.ok) {
            console.error(`Failed to fetch ${threadId}: HTTP ${res.status}`);
            return;
        }
        const data = await res.json();
        
        // Ensure directory exists
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
    const files = fs.readdirSync(THREADS_DIR);
    const threadIds = [];
    
    for (const file of files) {
        if (file.endsWith('_thread.html')) {
            const threadId = file.split('_thread.html')[0];
            threadIds.push(threadId);
        }
    }
    
    console.log(`Found ${threadIds.length} threads to update.`);
    for (let i = 0; i < threadIds.length; i++) {
        await fetchThread(threadIds[i]);
        // Add a small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 1000));
    }
    console.log('All threads updated!');
}

main().catch(console.error);
