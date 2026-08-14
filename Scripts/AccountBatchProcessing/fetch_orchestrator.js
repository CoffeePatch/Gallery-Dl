#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { AccountStateStore, countOriginalTweets } = require('../lib/accountStateStore');
const { calculateUntilDateFromFile } = require('../lib/dateAnchor');
const { recoverStagingAndBackupFiles } = require('../lib/recoveryHelper');

const DEFAULT_THRESHOLD = parseInt(process.env.USER_TIMELINE_HEURISTIC_THRESHOLD || '3000', 10);
const SEARCH_WINDOW_MONTHS = parseInt(process.env.SEARCH_WINDOW_MONTHS || '6', 10);
const INTER_ACCOUNT_DELAY_MS = parseInt(process.env.INTER_ACCOUNT_DELAY_MS || '5000', 10);
const COMPLETED_TTL_HOURS = parseFloat(process.env.COMPLETED_TTL_HOURS || '8');

function parseArgs() {
    const args = process.argv.slice(2);
    let mode = 'default';
    let threshold = DEFAULT_THRESHOLD;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--overwrite') mode = 'overwrite';
        else if (args[i] === '--skip') mode = 'skip';
        else if (args[i] === '--mode' && args[i + 1]) {
            mode = args[i + 1];
            i++;
        } else if (args[i] === '--threshold' && args[i + 1]) {
            threshold = parseInt(args[i + 1], 10);
            i++;
        } else if (!args[i].startsWith('--')) {
            mode = args[i];
        }
    }
    return { mode, threshold };
}

function cleanHandle(handleStr) {
    if (!handleStr || typeof handleStr !== 'string') return null;
    let clean = handleStr.trim();
    if (!clean || clean.startsWith('#')) return null;

    if (clean.startsWith('http://') || clean.startsWith('https://')) {
        // Must be a twitter.com or x.com domain
        if (!/^https?:\/\/(www\.)?(twitter|x)\.com\//i.test(clean)) {
            return null;
        }
        // Ignore twitter system paths (e.g. /i/bookmarks, /i/api, etc.)
        if (/^https?:\/\/(www\.)?(twitter|x)\.com\/i\//i.test(clean)) {
            return null;
        }
        try {
            const urlObj = new URL(clean);
            const pathParts = urlObj.pathname.split('/').filter(p => p.length > 0);
            if (pathParts.length > 0) {
                clean = pathParts[0];
            }
        } catch (e) {
            return null;
        }
    } else {
        clean = clean.replace(/^@/, '');
    }

    clean = clean.replace(/\?.*$/, '').replace(/\/.*$/, '').trim();

    // Ignore reserved system paths
    const reserved = ['home', 'explore', 'notifications', 'messages', 'search', 'settings', 'i', 'bookmarks', 'tos', 'privacy'];
    if (!clean || reserved.includes(clean.toLowerCase())) {
        return null;
    }
    return clean;
}

function cleanPoisonedErrorFile(filePath, store, username) {
    if (!fs.existsSync(filePath)) return false;
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 1 && Array.isArray(parsed[0]) && parsed[0][0] === -1 && parsed[0][1] && parsed[0][1].error) {
            console.warn(`[ORCHESTRATOR] Detected poisoned error file for @${username}. Cleaning up...`);
            fs.unlinkSync(filePath);
            if (store) {
                store.setState(username, { state: 'STATE_USER', originalTweetCount: 0 });
            }
            return true;
        }
    } catch (e) {}
    return false;
}

async function main() {
    const { mode, threshold } = parseArgs();
    const scriptDir = __dirname;
    const rootDir = path.resolve(scriptDir, '..');
    const usersFile = path.join(rootDir, 'Config', 'Users', 'users.txt');
    const configFile = path.join(rootDir, 'Config', 'Settings', 'config.json');
    const cookiesFile = path.join(rootDir, 'Config', 'Cookies', 'cookies.txt');
    const outputDir = mode === 'overwrite' ? path.join(rootDir, 'TweetData', 'NewRawData') : path.join(rootDir, 'TweetData', 'RawData');
    const accountStatusDir = path.join(rootDir, 'TweetData', 'AccountStatus');
    const jsonMergerScript = path.join(scriptDir, 'json_merger.js');

    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(accountStatusDir, { recursive: true });

    console.log("=============================================");
    console.log(` Starting Node Scrape Orchestrator (${mode} mode)`);
    console.log(` Output Directory: ${outputDir}`);
    console.log(` Account Status : ${accountStatusDir}`);
    console.log(` UserTimeline Heuristic Threshold: ${threshold}`);
    console.log(` Inter-Account Delay: ${INTER_ACCOUNT_DELAY_MS}ms`);
    console.log(` Completed Account TTL: ${COMPLETED_TTL_HOURS}h`);
    console.log("=============================================");

    if (!fs.existsSync(usersFile)) {
        console.error(`[ORCHESTRATOR ERROR] Users file not found: ${usersFile}`);
        process.exit(1);
    }

    const lines = fs.readFileSync(usersFile, 'utf8')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#'));

    if (lines.length === 0) {
        console.log("[ORCHESTRATOR INFO] Input file is empty. Nothing to process.");
        process.exit(0);
    }

    let processedCount = 0;

    for (const handleStr of lines) {
        const cleanUsername = cleanHandle(handleStr);
        if (!cleanUsername) {
            console.log(`[ORCHESTRATOR SKIP] Invalid or non-profile entry skipped: "${handleStr}"`);
            continue;
        }

        processedCount++;
        console.log(`\n[${processedCount}/${lines.length}] Target: @${cleanUsername}`);

        const jsonTargetFile = path.join(outputDir, `${cleanUsername}_tweets.json`);
        const userArchiveFile = path.join(accountStatusDir, `${cleanUsername}_archive.sqlite3`);

        if (mode === 'overwrite') {
            if (fs.existsSync(jsonTargetFile)) fs.unlinkSync(jsonTargetFile);
            if (fs.existsSync(userArchiveFile)) fs.unlinkSync(userArchiveFile);
        }

        const store = new AccountStateStore(userArchiveFile);
        try {
            await recoverStagingAndBackupFiles(jsonTargetFile, store);
            cleanPoisonedErrorFile(jsonTargetFile, store, cleanUsername);

            let currentState = store.getState(cleanUsername);
            let stateStr = currentState.state || 'STATE_USER';

            if (mode === 'overwrite') {
                stateStr = 'STATE_USER';
                store.setState(cleanUsername, { state: 'STATE_USER', originalTweetCount: 0 });
            }

            if (stateStr === 'COMPLETED' && mode !== 'overwrite') {
                let isStale = true;
                if (currentState.updated_at) {
                    const lastUpdated = new Date(currentState.updated_at).getTime();
                    const now = Date.now();
                    const diffHours = (now - lastUpdated) / (1000 * 60 * 60);
                    if (diffHours < COMPLETED_TTL_HOURS) {
                        isStale = false;
                    }
                }

                if (!isStale) {
                    console.log(`[ORCHESTRATOR] Account @${cleanUsername} is COMPLETED (updated < ${COMPLETED_TTL_HOURS}h ago). Skipping.`);
                    continue;
                } else {
                    console.log(`[ORCHESTRATOR] Account @${cleanUsername} is COMPLETED but last update was > ${COMPLETED_TTL_HOURS}h ago. Launching incremental UserTweets re-check.`);
                    stateStr = 'STATE_USER';
                }
            }

            // PHASE 1: STATE_USER (UserTimeline)
            if (stateStr === 'STATE_USER') {
                console.log(`[ORCHESTRATOR] Phase: STATE_USER for @${cleanUsername}`);
                const targetUrl = `https://twitter.com/${cleanUsername}`;

                const gdlArgs = [
                    jsonMergerScript,
                    jsonTargetFile,
                    mode,
                    cleanUsername,
                    userArchiveFile,
                    '--',
                    '--config-ignore',
                    '--verbose',
                    '--resolve-json'
                ];
                if (fs.existsSync(configFile)) gdlArgs.push('--config-json', configFile);
                if (fs.existsSync(cookiesFile)) gdlArgs.push('--cookies', cookiesFile);
                gdlArgs.push(targetUrl);

                console.log(`[ORCHESTRATOR] Launching UserTweets fetch for @${cleanUsername}...`);
                const proc = spawnSync(process.execPath, gdlArgs, { stdio: 'inherit' });

                if (proc.status === 65) {
                    console.error(`[ORCHESTRATOR ERROR] gallery-dl/json_merger reported API error for @${cleanUsername}. Retaining state STATE_USER for retry.`);
                    continue;
                }

                const inserted = store.syncJsonTweets(jsonTargetFile);
                const origCount = countOriginalTweets(jsonTargetFile, cleanUsername);
                console.log(`[ORCHESTRATOR] UserTweets finished for @${cleanUsername}. Original tweets: ${origCount}. Synced ${inserted} IDs.`);

                if (origCount >= threshold) {
                    stateStr = 'STATE_SEARCH';
                    store.setState(cleanUsername, {
                        state: 'STATE_SEARCH',
                        searchReason: 'COUNT_THRESHOLD',
                        originalTweetCount: origCount
                    });
                    console.log(`[ORCHESTRATOR] Original tweets reached threshold (${origCount} >= ${threshold}). Updated state to STATE_SEARCH.`);
                } else {
                    stateStr = 'COMPLETED';
                    store.setState(cleanUsername, {
                        state: 'COMPLETED',
                        searchReason: null,
                        originalTweetCount: origCount
                    });
                    console.log(`[ORCHESTRATOR] Account @${cleanUsername} completed via UserTweets (${origCount} original tweets). State set to COMPLETED.`);
                }
            }

            // PHASE 2: STATE_SEARCH (SearchTimeline Fallback)
            if (stateStr === 'STATE_SEARCH') {
                console.log(`[ORCHESTRATOR] Phase: STATE_SEARCH for @${cleanUsername}`);
                if (!fs.existsSync(jsonTargetFile)) {
                    console.error(`[ORCHESTRATOR ERROR] JSON target file missing for @${cleanUsername}. Cannot anchor search.`);
                    continue;
                }

                const untilDate = calculateUntilDateFromFile(jsonTargetFile);
                if (!untilDate || !/^\d{4}-\d{2}-\d{2}$/.test(untilDate)) {
                    console.error(`[ORCHESTRATOR ERROR] Could not parse date anchor for @${cleanUsername}.`);
                    continue;
                }

                store.generateSearchWindows(cleanUsername, untilDate, SEARCH_WINDOW_MONTHS);

                const incompleteWindows = store.getIncompleteWindows(cleanUsername);
                if (incompleteWindows.length === 0) {
                    const totalOrigCount = countOriginalTweets(jsonTargetFile, cleanUsername);
                    store.setState(cleanUsername, {
                        state: 'COMPLETED',
                        searchReason: 'SEARCH_FINISHED',
                        originalTweetCount: totalOrigCount
                    });
                    console.log(`[ORCHESTRATOR] All search windows completed for @${cleanUsername}. State set to COMPLETED.`);
                    continue;
                }

                let allWindowsSucceeded = true;
                let isFirstWindow = true; // Used for boundary overlap verification

                for (const win of incompleteWindows) {
                    const searchUrl = `https://x.com/search?q=from:${cleanUsername} -filter:replies since:${win.since_date} until:${win.until_date}`;
                    console.log(`\n[ORCHESTRATOR] Searching window: since:${win.since_date} until:${win.until_date}`);

                    const searchGdlArgs = [
                        jsonMergerScript,
                        jsonTargetFile,
                        mode,
                        cleanUsername,
                        userArchiveFile,
                        'no-dupe-abort',
                        '--',
                        '--config-ignore',
                        '--verbose',
                        '--resolve-json'
                    ];
                    if (fs.existsSync(configFile)) searchGdlArgs.push('--config-json', configFile);
                    if (fs.existsSync(cookiesFile)) searchGdlArgs.push('--cookies', cookiesFile);
                    searchGdlArgs.push('-o', 'twitter.search-pagination=until', '-o', 'twitter.ratelimit=wait', searchUrl);

                    const proc = spawnSync(process.execPath, searchGdlArgs, { stdio: 'inherit' });

                    if (proc.status === 0) {
                        store.syncJsonTweets(jsonTargetFile);

                        if (isFirstWindow) {
                            const hasOverlap = store.hasOverlapWithExisting(jsonTargetFile);
                            if (!hasOverlap) {
                                console.warn(`[ORCHESTRATOR WARNING] No boundary overlap detected for @${cleanUsername} between UserTimeline and first Search window. Possible gap!`);
                            } else {
                                console.log(`[ORCHESTRATOR] Boundary overlap verified seamlessly for @${cleanUsername}.`);
                            }
                        }

                        store.markWindowCompleted(cleanUsername, win.since_date, win.until_date);
                        console.log(`[ORCHESTRATOR] Completed window ${win.since_date} -> ${win.until_date}`);
                    } else {
                        console.error(`[ORCHESTRATOR ERROR] gallery-dl/json_merger failed for window ${win.since_date} -> ${win.until_date} (code ${proc.status}). Suspending Search phase to allow clean resume later.`);
                        allWindowsSucceeded = false;
                        break;
                    }

                    isFirstWindow = false;
                }

                if (allWindowsSucceeded) {
                    const totalOrigCount = countOriginalTweets(jsonTargetFile, cleanUsername);
                    store.setState(cleanUsername, {
                        state: 'COMPLETED',
                        searchReason: 'SEARCH_FINISHED',
                        originalTweetCount: totalOrigCount
                    });
                    console.log(`[ORCHESTRATOR] All search windows completed for @${cleanUsername}. State set to COMPLETED.`);
                }
            }

        } finally {
            store.close();
        }

        if (processedCount < lines.length && INTER_ACCOUNT_DELAY_MS > 0) {
            console.log(`[ORCHESTRATOR] Sleeping ${INTER_ACCOUNT_DELAY_MS / 1000}s before next account...`);
            spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${INTER_ACCOUNT_DELAY_MS})`]);
        }
    }

    console.log("\n[ORCHESTRATOR DONE] Batch scraping completed successfully.");
}

if (require.main === module) {
    main();
}

module.exports = {
    cleanHandle,
    parseArgs,
    main
};
