const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function nowIso() {
    return new Date().toISOString();
}

class AccountStateStore {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.db = null;
    }

    _getDb() {
        if (!this.db) {
            fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');
            this.migrate();
        }
        return this.db;
    }

    migrate() {
        const db = this.db;
        const currentVersion = db.pragma('user_version', { simple: true });

        if (currentVersion < 1) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS gallery_dl (
                    extractor TEXT,
                    id TEXT,
                    PRIMARY KEY (extractor, id)
                );

                CREATE TABLE IF NOT EXISTS account_fetch_state (
                    username TEXT PRIMARY KEY,
                    state TEXT NOT NULL,
                    oldest_archived_tweet_id TEXT,
                    search_reason TEXT,
                    original_tweet_count INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            `);
            db.pragma('user_version = 1');
        }

        if (currentVersion < 2) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS account_search_windows (
                    username TEXT,
                    since_date TEXT NOT NULL,
                    until_date TEXT NOT NULL,
                    is_completed INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (username, since_date, until_date)
                );
            `);
            db.pragma('user_version = 2');
        }
    }

    getState(username) {
        const db = this._getDb();
        const cleanUser = String(username).toLowerCase().trim();
        const stmt = db.prepare('SELECT * FROM account_fetch_state WHERE username = ?');
        const row = stmt.get(cleanUser);
        if (!row) {
            return {
                username: cleanUser,
                state: 'STATE_USER',
                oldest_archived_tweet_id: null,
                search_reason: null,
                original_tweet_count: 0,
                created_at: null,
                updated_at: null
            };
        }
        return row;
    }

    setState(username, { state, oldestArchivedTweetId = null, searchReason = null, originalTweetCount = 0 }) {
        const db = this._getDb();
        const cleanUser = String(username).toLowerCase().trim();
        const now = nowIso();

        const stmt = db.prepare(`
            INSERT INTO account_fetch_state (
                username, state, oldest_archived_tweet_id, search_reason, original_tweet_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
                state = excluded.state,
                oldest_archived_tweet_id = COALESCE(excluded.oldest_archived_tweet_id, account_fetch_state.oldest_archived_tweet_id),
                search_reason = COALESCE(excluded.search_reason, account_fetch_state.search_reason),
                original_tweet_count = excluded.original_tweet_count,
                updated_at = excluded.updated_at
        `);

        stmt.run(
            cleanUser,
            state,
            oldestArchivedTweetId,
            searchReason,
            originalTweetCount,
            now,
            now
        );
    }

    generateSearchWindows(username, anchorDateStr, windowMonths = 6) {
        const db = this._getDb();
        const cleanUser = String(username).toLowerCase().trim();
        
        const checkStmt = db.prepare('SELECT COUNT(*) as count FROM account_search_windows WHERE username = ?');
        const count = checkStmt.get(cleanUser).count;
        if (count > 0) return;

        const TWITTER_EPOCH = new Date('2006-03-01T00:00:00Z');
        let currentUntil = new Date(`${anchorDateStr}T00:00:00Z`);

        const insertStmt = db.prepare(`
            INSERT INTO account_search_windows (username, since_date, until_date, is_completed, created_at)
            VALUES (?, ?, ?, 0, ?)
        `);

        const insertMany = db.transaction((windows) => {
            const now = nowIso();
            for (const win of windows) {
                insertStmt.run(cleanUser, win.since, win.until, now);
            }
        });

        const windowsToInsert = [];
        while (currentUntil > TWITTER_EPOCH) {
            let currentSince = new Date(currentUntil);
            currentSince.setUTCMonth(currentSince.getUTCMonth() - windowMonths);
            
            if (currentSince < TWITTER_EPOCH) {
                currentSince = new Date(TWITTER_EPOCH);
            }

            const formatYMD = (d) => {
                const y = d.getUTCFullYear();
                const m = String(d.getUTCMonth() + 1).padStart(2, '0');
                const dy = String(d.getUTCDate()).padStart(2, '0');
                return `${y}-${m}-${dy}`;
            };

            windowsToInsert.push({
                until: formatYMD(currentUntil),
                since: formatYMD(currentSince)
            });

            currentUntil = currentSince;
        }

        insertMany(windowsToInsert);
    }

    getIncompleteWindows(username) {
        const db = this._getDb();
        const cleanUser = String(username).toLowerCase().trim();
        const stmt = db.prepare('SELECT * FROM account_search_windows WHERE username = ? AND is_completed = 0 ORDER BY until_date DESC');
        return stmt.all(cleanUser);
    }

    markWindowCompleted(username, since_date, until_date) {
        const db = this._getDb();
        const cleanUser = String(username).toLowerCase().trim();
        const stmt = db.prepare('UPDATE account_search_windows SET is_completed = 1 WHERE username = ? AND since_date = ? AND until_date = ?');
        stmt.run(cleanUser, since_date, until_date);
    }

    hasOverlapWithExisting(jsonFilePath) {
        if (!fs.existsSync(jsonFilePath)) return false;
        const db = this._getDb();
        let records = [];
        try {
            const raw = fs.readFileSync(jsonFilePath, 'utf8');
            records = JSON.parse(raw);
        } catch (e) {
            return false;
        }

        const checkStmt = db.prepare('SELECT 1 FROM gallery_dl WHERE extractor = ? AND id = ?');
        for (const record of records) {
            if (Array.isArray(record) && record.length > 1 && record[0] === 2 && record[1] && record[1].tweet_id) {
                const exists = checkStmt.get('twitter', String(record[1].tweet_id));
                if (exists) return true;
            }
        }
        return false;
    }

    syncJsonTweets(jsonFilePath) {
        if (!fs.existsSync(jsonFilePath)) return 0;
        const db = this._getDb();
        let records = [];
        try {
            const raw = fs.readFileSync(jsonFilePath, 'utf8');
            records = JSON.parse(raw);
        } catch (e) {
            return 0;
        }

        const insertStmt = db.prepare('INSERT OR IGNORE INTO gallery_dl (extractor, id) VALUES (?, ?)');
        const insertMany = db.transaction((records) => {
            let count = 0;
            for (const record of records) {
                if (Array.isArray(record) && record.length > 1 && record[0] === 2 && record[1] && record[1].tweet_id) {
                    const info = insertStmt.run('twitter', String(record[1].tweet_id));
                    if (info.changes > 0) count++;
                }
            }
            return count;
        });

        return insertMany(records);
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

function countOriginalTweets(jsonFilePath, targetUsername) {
    if (!fs.existsSync(jsonFilePath)) return 0;
    const cleanUser = targetUsername ? String(targetUsername).toLowerCase().trim() : '';
    try {
        const raw = fs.readFileSync(jsonFilePath, 'utf8');
        const records = JSON.parse(raw);
        let count = 0;
        for (const record of records) {
            if (Array.isArray(record) && record[0] === 2 && record[1]) {
                const tweet = record[1];
                const isRetweet = tweet.retweet_id && tweet.retweet_id !== 0 && tweet.retweet_id !== '0';
                if (isRetweet) continue;
                
                const replyTo = tweet.reply_to ? String(tweet.reply_to).toLowerCase().trim() : '';
                if (replyTo && cleanUser && replyTo !== cleanUser) {
                    // reply to someone else
                    continue;
                }
                count++;
            }
        }
        return count;
    } catch (e) {
        return 0;
    }
}

module.exports = {
    AccountStateStore,
    countOriginalTweets
};
