const fs = require('fs');

function parseHandle(line) {
    if (typeof line !== 'string') return null;
    let handle = line.trim();
    if (!handle || handle.startsWith('#')) return null;
    const urlMatch = handle.match(/^(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[\/?#]|$)/i);
    if (urlMatch) return urlMatch[1];
    handle = handle.replace(/^@/, '');
    return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

function loadCookiesFromTxt(txtPath) {
    if (!fs.existsSync(txtPath)) return { cookies: [], origins: [] };
    const lines = fs.readFileSync(txtPath, 'utf8').split('\n');
    const cookies = [];
    lines.forEach(line => {
        if (line.trim() === '' || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) return;
        let t = line;
        if (t.startsWith('#HttpOnly_')) t = t.substring(10);
        const parts = t.split('\t');
        if (parts.length >= 7) {
            cookies.push({
                domain: parts[0],
                path: parts[2],
                secure: parts[3] === 'TRUE',
                expires: parseInt(parts[4]) || -1,
                name: parts[5],
                value: parts[6].trim()
            });
        }
    });
    return { cookies, origins: [] };
}

module.exports = {
    parseHandle,
    loadCookiesFromTxt
};
