const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function inferArchiveSourceType(url = '') {
    if (typeof url !== 'string') return 'unknown';
    if (url.includes('threadreaderapp.com')) return 'threadreader';
    if (url.includes('x.com') || url.includes('twitter.com')) return 'x_thread';
    if (url.startsWith('local-file://')) return 'local_html_archive';
    return 'unknown';
}

function nowIso() {
    return new Date().toISOString();
}

function normalizeEntry(entry) {
    return {
        thread_id: String(entry.thread_id || entry.threadId || '').trim(),
        source_url: String(entry.source_url || entry.sourceUrl || '').trim(),
        source_type: String(entry.source_type || entry.sourceType || '').trim() || inferArchiveSourceType(entry.source_url || entry.sourceUrl),
        profile_url: entry.profile_url || entry.profileUrl || null,
        content_hash: entry.content_hash || entry.contentHash || null,
        output_path: entry.output_path || entry.outputPath || null,
        error_message: entry.error_message || entry.errorMessage || null,
        status: entry.status || 'archived',
        retry_count: Number(entry.retry_count || entry.retryCount || 0),
        created_at: entry.created_at || entry.createdAt || nowIso(),
        updated_at: entry.updated_at || entry.updatedAt || nowIso(),
        archived_at: entry.archived_at || entry.archivedAt || null,
    };
}

function normalizeAccountEntry(entry) {
    const account_id = String(entry.accountId || entry.account_id || '').trim();
    return {
        account_id,
        source_url: String(entry.sourceUrl || entry.source_url || '').trim(),
        status: entry.status || 'checked',
        last_error: entry.lastError || entry.last_error || entry.errorMessage || entry.error_message || null,
        result_summary: entry.resultSummary || entry.result_summary || null,
        output_path: entry.outputPath || entry.output_path || null,
        retry_count: Number(entry.retryCount || entry.retry_count || 0),
        created_at: entry.createdAt || entry.created_at || nowIso(),
        updated_at: entry.updatedAt || entry.updated_at || nowIso(),
    };
}

class ArchiveStateStore {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this._db = null;
    }

    _getDb() {
        if (!this._db) {
            fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
            this._db = new DatabaseSync(this.dbPath);
            this._db.exec('PRAGMA journal_mode=WAL;');
            this._db.exec('PRAGMA foreign_keys=ON;');
        }
        return this._db;
    }

    init() {
        const db = this._getDb();
        db.exec(`
            CREATE TABLE IF NOT EXISTS archive_state (
                thread_id TEXT PRIMARY KEY,
                source_url TEXT NOT NULL,
                source_type TEXT NOT NULL,
                profile_url TEXT,
                status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'archived', 'failed')),
                archived_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                retry_count INTEGER NOT NULL DEFAULT 0,
                content_hash TEXT,
                output_path TEXT,
                error_message TEXT
            );

            CREATE TABLE IF NOT EXISTS archive_state_attempts (
                attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id TEXT NOT NULL,
                source_url TEXT NOT NULL,
                source_type TEXT NOT NULL,
                profile_url TEXT,
                status TEXT NOT NULL,
                archived_at TEXT,
                created_at TEXT NOT NULL,
                content_hash TEXT,
                output_path TEXT,
                error_message TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_archive_state_status ON archive_state(status);
            CREATE INDEX IF NOT EXISTS idx_archive_state_profile_url ON archive_state(profile_url);
            CREATE INDEX IF NOT EXISTS idx_archive_state_attempts_thread_created ON archive_state_attempts(thread_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS account_state (
                account_id TEXT PRIMARY KEY,
                source_url TEXT,
                status TEXT NOT NULL CHECK (status IN ('checked', 'processing', 'failed')),
                last_error TEXT,
                result_summary TEXT,
                output_path TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_account_state_status ON account_state(status);
        `);
    }

    _upsertArchived(entry) {
        const db = this._getDb();
        const norm = normalizeEntry(entry);
        const archivedAt = norm.archived_at || nowIso();

        const stmt = db.prepare(`
            INSERT INTO archive_state (
                thread_id, source_url, source_type, profile_url, status,
                archived_at, created_at, updated_at, retry_count, content_hash, output_path, error_message
            ) VALUES (?, ?, ?, ?, 'archived', ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(thread_id) DO UPDATE SET
                source_url = excluded.source_url,
                source_type = excluded.source_type,
                profile_url = excluded.profile_url,
                status = 'archived',
                archived_at = excluded.archived_at,
                updated_at = excluded.updated_at,
                retry_count = archive_state.retry_count,
                content_hash = excluded.content_hash,
                output_path = excluded.output_path,
                error_message = NULL
        `);

        stmt.run(
            norm.thread_id,
            norm.source_url,
            norm.source_type,
            norm.profile_url,
            archivedAt,
            norm.created_at,
            norm.updated_at,
            norm.retry_count,
            norm.content_hash,
            norm.output_path
        );
    }

    _insertAttempt(entry) {
        const db = this._getDb();
        const norm = normalizeEntry(entry);
        const stmt = db.prepare(`
            INSERT INTO archive_state_attempts (
                thread_id, source_url, source_type, profile_url, status,
                archived_at, created_at, content_hash, output_path, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            norm.thread_id,
            norm.source_url,
            norm.source_type,
            norm.profile_url,
            norm.status,
            norm.archived_at,
            norm.created_at,
            norm.content_hash,
            norm.output_path,
            norm.error_message
        );
    }

    seedLegacyCompletedThreads(filePath) {
        if (!fs.existsSync(filePath)) return 0;

        const urls = fs.readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#'));

        if (urls.length === 0) return 0;

        let count = 0;
        for (const url of urls) {
            const threadId = url.match(/\/(\d+)(?:\.html)?$/)?.[1] || url.split('?')[0].replace(/\/+$/, '');
            if (!threadId || !url) continue;

            this._upsertArchived({
                thread_id: threadId,
                source_url: url,
                source_type: inferArchiveSourceType(url),
                profile_url: null,
                archived_at: nowIso(),
                retry_count: 0
            });
            count++;
        }

        return count;
    }

    seedExistingArchiveFiles(threadsRootDir) {
        if (!fs.existsSync(threadsRootDir)) return 0;

        const entries = [];
        const stack = [threadsRootDir];

        while (stack.length > 0) {
            const currentDir = stack.pop();
            for (const dirent of fs.readdirSync(currentDir, { withFileTypes: true })) {
                const fullPath = path.join(currentDir, dirent.name);
                if (dirent.isDirectory()) {
                    stack.push(fullPath);
                    continue;
                }

                if (!dirent.isFile()) continue;
                if (path.extname(dirent.name).toLowerCase() !== '.html') continue;

                const match = dirent.name.match(/(\d+)/);
                if (!match) continue;

                const stats = fs.statSync(fullPath);
                entries.push({
                    thread_id: match[1],
                    source_url: `local-file://${fullPath.replace(/\\/g, '/')}`,
                    source_type: 'local_html_archive',
                    profile_url: null,
                    output_path: fullPath,
                    archived_at: stats.mtime.toISOString(),
                    created_at: stats.birthtime.toISOString(),
                    updated_at: stats.mtime.toISOString(),
                    retry_count: 0
                });
            }
        }

        let count = 0;
        for (const entry of entries) {
            this._upsertArchived(entry);
            count++;
        }

        return count;
    }

    isArchived(threadId) {
        if (!threadId) return false;
        const db = this._getDb();
        const stmt = db.prepare("SELECT status FROM archive_state WHERE thread_id = ?");
        const row = stmt.get(String(threadId).trim());
        return Boolean(row && row.status === 'archived');
    }

    recordSuccess({ threadId, sourceUrl, sourceType, profileUrl = null, outputPath = null, contentHash = null }) {
        if (!threadId || !sourceUrl) {
            throw new Error('recordSuccess requires threadId and sourceUrl');
        }

        const entry = normalizeEntry({
            thread_id: threadId,
            source_url: sourceUrl,
            source_type: sourceType || inferArchiveSourceType(sourceUrl),
            profile_url: profileUrl,
            output_path: outputPath,
            content_hash: contentHash,
            status: 'archived',
            archived_at: nowIso()
        });

        this._upsertArchived(entry);
        this._insertAttempt(entry);
    }

    recordFailure({ threadId, sourceUrl, sourceType, profileUrl = null, errorMessage = null, outputPath = null, contentHash = null }) {
        if (!threadId || !sourceUrl) {
            throw new Error('recordFailure requires threadId and sourceUrl');
        }

        const db = this._getDb();
        const norm = normalizeEntry({
            thread_id: threadId,
            source_url: sourceUrl,
            source_type: sourceType || inferArchiveSourceType(sourceUrl),
            profile_url: profileUrl,
            output_path: outputPath,
            content_hash: contentHash,
            error_message: errorMessage || 'Thread archiving failed',
            status: 'failed'
        });

        const stmt = db.prepare(`
            INSERT INTO archive_state (
                thread_id, source_url, source_type, profile_url, status,
                archived_at, created_at, updated_at, retry_count, content_hash, output_path, error_message
            ) VALUES (?, ?, ?, ?, 'failed', NULL, ?, ?, 1, ?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET
                source_url = excluded.source_url,
                source_type = excluded.source_type,
                profile_url = excluded.profile_url,
                status = 'failed',
                updated_at = excluded.updated_at,
                retry_count = archive_state.retry_count + 1,
                content_hash = excluded.content_hash,
                output_path = excluded.output_path,
                error_message = excluded.error_message
        `);

        stmt.run(
            norm.thread_id,
            norm.source_url,
            norm.source_type,
            norm.profile_url,
            norm.created_at,
            norm.updated_at,
            norm.content_hash,
            norm.output_path,
            norm.error_message
        );

        this._insertAttempt(norm);
    }

    shouldProcessAccount(accountId) {
        if (!accountId) return true;
        const db = this._getDb();
        const stmt = db.prepare("SELECT status FROM account_state WHERE account_id = ?");
        const row = stmt.get(String(accountId).trim());
        if (!row) return true;
        return row.status !== 'processing';
    }

    recordAccountProcessing({ accountId, sourceUrl = null, resultSummary = null, outputPath = null }) {
        if (!accountId) throw new Error('recordAccountProcessing requires accountId');
        const db = this._getDb();
        const norm = normalizeAccountEntry({ accountId, sourceUrl, resultSummary, outputPath, status: 'processing' });

        const stmt = db.prepare(`
            INSERT INTO account_state (
                account_id, source_url, status, last_error, result_summary, output_path, retry_count, created_at, updated_at
            ) VALUES (?, ?, 'processing', NULL, ?, ?, 0, ?, ?)
            ON CONFLICT(account_id) DO UPDATE SET
                source_url = CASE WHEN excluded.source_url != '' THEN excluded.source_url ELSE account_state.source_url END,
                status = 'processing',
                result_summary = COALESCE(excluded.result_summary, account_state.result_summary),
                output_path = COALESCE(excluded.output_path, account_state.output_path),
                updated_at = excluded.updated_at
        `);

        stmt.run(
            norm.account_id,
            norm.source_url,
            norm.result_summary,
            norm.output_path,
            norm.created_at,
            norm.updated_at
        );
    }

    recordAccountCheck({ accountId, sourceUrl = null, resultSummary = null, outputPath = null }) {
        if (!accountId) throw new Error('recordAccountCheck requires accountId');
        const db = this._getDb();
        const norm = normalizeAccountEntry({ accountId, sourceUrl, resultSummary, outputPath, status: 'checked' });

        const stmt = db.prepare(`
            INSERT INTO account_state (
                account_id, source_url, status, last_error, result_summary, output_path, retry_count, created_at, updated_at
            ) VALUES (?, ?, 'checked', NULL, ?, ?, 0, ?, ?)
            ON CONFLICT(account_id) DO UPDATE SET
                source_url = CASE WHEN excluded.source_url != '' THEN excluded.source_url ELSE account_state.source_url END,
                status = 'checked',
                last_error = NULL,
                result_summary = COALESCE(excluded.result_summary, account_state.result_summary),
                output_path = COALESCE(excluded.output_path, account_state.output_path),
                updated_at = excluded.updated_at
        `);

        stmt.run(
            norm.account_id,
            norm.source_url,
            norm.result_summary,
            norm.output_path,
            norm.created_at,
            norm.updated_at
        );
    }

    recordAccountFailure({ accountId, sourceUrl = null, errorMessage = null, resultSummary = null, outputPath = null }) {
        if (!accountId) throw new Error('recordAccountFailure requires accountId');
        const db = this._getDb();
        const norm = normalizeAccountEntry({ accountId, sourceUrl, lastError: errorMessage, resultSummary, outputPath, status: 'failed' });

        const stmt = db.prepare(`
            INSERT INTO account_state (
                account_id, source_url, status, last_error, result_summary, output_path, retry_count, created_at, updated_at
            ) VALUES (?, ?, 'failed', ?, ?, ?, 1, ?, ?)
            ON CONFLICT(account_id) DO UPDATE SET
                source_url = CASE WHEN excluded.source_url != '' THEN excluded.source_url ELSE account_state.source_url END,
                status = 'failed',
                last_error = excluded.last_error,
                result_summary = COALESCE(excluded.result_summary, account_state.result_summary),
                output_path = COALESCE(excluded.output_path, account_state.output_path),
                retry_count = account_state.retry_count + 1,
                updated_at = excluded.updated_at
        `);

        stmt.run(
            norm.account_id,
            norm.source_url,
            norm.last_error,
            norm.result_summary,
            norm.output_path,
            norm.created_at,
            norm.updated_at
        );
    }
}

module.exports = {
    ArchiveStateStore,
    inferArchiveSourceType
};