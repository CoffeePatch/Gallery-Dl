const fs = require('fs');
const path = require('path');
const cookies = fs.readFileSync('Config/Cookies/cookies.txt', 'utf8');
const auth = JSON.parse(fs.readFileSync('Config/Settings/auth.json', 'utf8'));
const payloadConfig = JSON.parse(fs.readFileSync('Config/Settings/graphql_api_payload.json', 'utf8'));
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
                // Skip cookies that break node's fetch
                if (name !== 'g_state' && !value.includes('\n')) {
                    cookiePairs.push(`${name}=${value}`);
                }
            }
        }
    }
    cookieString = cookiePairs.join('; ');
}

const params = new URLSearchParams({
    variables: JSON.stringify({
        focalTweetId: '1655003267615666176',
        ...payloadConfig.variables
    }),
    features: JSON.stringify(payloadConfig.features)
});

if (payloadConfig.fieldToggles) {
    params.append('fieldToggles', JSON.stringify(payloadConfig.fieldToggles));
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

fetch(url + '?' + params.toString(), { headers })
    .then(r => r.json())
    .then(data => fs.writeFileSync('test_tweet.json', JSON.stringify(data, null, 2)))
    .catch(console.error);
