const fs = require('fs');

function parseCookies(cookieText) {
    const cookies = {};
    const lines = cookieText.split('\n');
    for (const line of lines) {
        if (line.trim() === '' || line.startsWith('#')) continue;
        const parts = line.split('\t');
        if (parts.length >= 7) {
            const name = parts[5];
            const value = parts[6].trim();
            cookies[name] = value;
        }
    }
    return cookies;
}

function loadNetscapeCookiesForPuppeteer(cookiesPath) {
    if (!fs.existsSync(cookiesPath)) return [];
    const content = fs.readFileSync(cookiesPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const cookies = [];

    for (let line of lines) {
        line = line.trim();
        if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;

        let isHttpOnly = false;
        if (line.startsWith('#HttpOnly_')) {
            isHttpOnly = true;
            line = line.substring(10);
        }

        const parts = line.split('\t');
        if (parts.length >= 7) {
            const domain = parts[0];
            const pathVal = parts[2];
            const secure = parts[3].toUpperCase() === 'TRUE';
            let expires = parseInt(parts[4]);
            if (isNaN(expires) || expires <= 0) expires = undefined;
            const name = parts[5];
            const value = parts[6].trim();

            cookies.push({
                name: name,
                value: value,
                domain: domain,
                path: pathVal,
                secure: secure,
                httpOnly: isHttpOnly,
                expires: expires
            });

            if (domain.includes('twitter.com')) {
                cookies.push({ name, value, domain: domain.replace('twitter.com', 'x.com'), path: pathVal, secure, httpOnly: isHttpOnly, expires });
            } else if (domain.includes('x.com')) {
                cookies.push({ name, value, domain: domain.replace('x.com', 'twitter.com'), path: pathVal, secure, httpOnly: isHttpOnly, expires });
            }
        }
    }
    return cookies;
}

async function getApiCredentials(cookieString) {
    const fallbackQueryId = "jd3V43oDY9cY7obs1YMfbQ";
    let queryId = fallbackQueryId;
    let bearerToken = null;

    try {
        const res = await fetch("https://x.com/", {
            headers: { 
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                "cookie": cookieString
            },
            signal: AbortSignal.timeout(20000)
        });
        const html = await res.text();
        const mainJsMatch = html.match(/src="(https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-z0-9]+\.js)"/);
        if (mainJsMatch) {
            const jsRes = await fetch(mainJsMatch[1], {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36" },
                signal: AbortSignal.timeout(20000)
            });
            const jsText = await jsRes.text();
            
            const qMatch = jsText.match(/queryId:"([^"]+)",operationName:"TweetDetail"/);
            if (qMatch) queryId = qMatch[1];
            
            const bearerMatch = jsText.match(/Bearer (AAAAAAAAAAAAAAAAAAAAA[^"']+)/);
            if (bearerMatch) bearerToken = bearerMatch[1];
        }
    } catch (e) {
        console.warn("[API] Failed to dynamically fetch API credentials, using fallback query ID:", e.message);
    }
    return { queryId, bearerToken };
}

module.exports = {
    parseCookies,
    loadNetscapeCookiesForPuppeteer,
    getApiCredentials
};
