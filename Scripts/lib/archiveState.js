const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PYTHON_COMMAND = process.env.PYTHON || 'python';

const SQLITE_HELPER_PY = String.raw`
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def connect(db_path):
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def ensure_schema(conn):
    conn.executescript(
        """
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
        """
    )


def normalize_entry(entry):
    return {
        'thread_id': str(entry['thread_id']).strip(),
        'source_url': str(entry['source_url']).strip(),
        'source_type': str(entry['source_type']).strip() or 'unknown',
        'profile_url': entry.get('profile_url') or None,
        'content_hash': entry.get('content_hash') or None,
        'output_path': entry.get('output_path') or None,
        'error_message': entry.get('error_message') or None,
        'status': entry.get('status') or 'archived',
        'retry_count': int(entry.get('retry_count') or 0),
        'created_at': entry.get('created_at') or now_iso(),
        'updated_at': entry.get('updated_at') or now_iso(),
        'archived_at': entry.get('archived_at'),
    }


def upsert_archived(conn, entry):
    entry = normalize_entry(entry)
    conn.execute(
        """
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
        """,
        [
            entry['thread_id'],
            entry['source_url'],
            entry['source_type'],
            entry['profile_url'],
            entry['archived_at'] or now_iso(),
            entry['created_at'],
            entry['updated_at'],
            entry['retry_count'],
            entry['content_hash'],
            entry['output_path'],
        ],
    )


def insert_attempt(conn, entry):
    entry = normalize_entry(entry)
    conn.execute(
        """
        INSERT INTO archive_state_attempts (
            thread_id, source_url, source_type, profile_url, status,
            archived_at, created_at, content_hash, output_path, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            entry['thread_id'],
            entry['source_url'],
            entry['source_type'],
            entry['profile_url'],
            entry['status'],
            entry['archived_at'],
            entry['created_at'],
            entry['content_hash'],
            entry['output_path'],
            entry['error_message'],
        ],
    )


def record_success(conn, entry):
    entry = normalize_entry(entry)
    archived_at = entry['archived_at'] or now_iso()
    timestamp = entry['updated_at']
    with conn:
        insert_attempt(conn, {
            **entry,
            'status': 'archived',
            'archived_at': archived_at,
            'created_at': timestamp,
            'updated_at': timestamp,
            'error_message': None,
        })
        conn.execute(
            """
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
            """,
            [
                entry['thread_id'],
                entry['source_url'],
                entry['source_type'],
                entry['profile_url'],
                archived_at,
                timestamp,
                timestamp,
                entry['retry_count'],
                entry['content_hash'],
                entry['output_path'],
            ],
        )


def record_failure(conn, entry):
    entry = normalize_entry(entry)
    timestamp = entry['updated_at']
    with conn:
        insert_attempt(conn, {
            **entry,
            'status': 'failed',
            'created_at': timestamp,
            'updated_at': timestamp,
        })
        conn.execute(
            """
            INSERT INTO archive_state (
                thread_id, source_url, source_type, profile_url, status,
                archived_at, created_at, updated_at, retry_count, content_hash, output_path, error_message
            ) VALUES (?, ?, ?, ?, 'failed', ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET
                source_url = excluded.source_url,
                source_type = excluded.source_type,
                profile_url = excluded.profile_url,
                status = 'failed',
                archived_at = COALESCE(archive_state.archived_at, excluded.archived_at),
                updated_at = excluded.updated_at,
                retry_count = archive_state.retry_count + 1,
                content_hash = COALESCE(excluded.content_hash, archive_state.content_hash),
                output_path = COALESCE(excluded.output_path, archive_state.output_path),
                error_message = excluded.error_message
            """,
            [
                entry['thread_id'],
                entry['source_url'],
                entry['source_type'],
                entry['profile_url'],
                entry['archived_at'],
                timestamp,
                timestamp,
                1,
                entry['content_hash'],
                entry['output_path'],
                entry['error_message'],
            ],
        )


def seed_completed(conn, entries):
    count = 0
    with conn:
        for entry in entries:
            upsert_archived(conn, {
                'thread_id': entry['thread_id'],
                'source_url': entry['source_url'],
                'source_type': entry['source_type'],
                'profile_url': entry.get('profile_url'),
                'content_hash': entry.get('content_hash'),
                'output_path': entry.get('output_path'),
                'created_at': entry.get('created_at'),
                'updated_at': entry.get('updated_at'),
                'archived_at': entry.get('archived_at') or now_iso(),
                'retry_count': entry.get('retry_count') or 0,
            })
            count += 1
    return count


def seed_archived_files(conn, entries):
    count = 0
    with conn:
        for entry in entries:
            upsert_archived(conn, {
                'thread_id': entry['thread_id'],
                'source_url': entry['source_url'],
                'source_type': entry['source_type'],
                'profile_url': entry.get('profile_url'),
                'content_hash': entry.get('content_hash'),
                'output_path': entry.get('output_path'),
                'created_at': entry.get('created_at'),
                'updated_at': entry.get('updated_at'),
                'archived_at': entry.get('archived_at') or now_iso(),
                'retry_count': entry.get('retry_count') or 0,
            })
            count += 1
    return count


def is_archived(conn, thread_id):
    row = conn.execute(
        "SELECT status FROM archive_state WHERE thread_id = ?",
        [thread_id],
    ).fetchone()
    return bool(row and row['status'] == 'archived')


def main():
    if len(sys.argv) < 3:
        raise SystemExit('Usage: archiveState helper <command> <dbPath> [payloadJson]')

    command = sys.argv[1]
    db_path = sys.argv[2]
    payload = {}
    if len(sys.argv) > 3 and sys.argv[3]:
        payload_arg = sys.argv[3]
        if os.path.exists(payload_arg):
            with open(payload_arg, 'r', encoding='utf-8') as handle:
                payload = json.load(handle)
        else:
            payload = json.loads(payload_arg)

    conn = connect(db_path)
    try:
        ensure_schema(conn)

        if command == 'init':
            print(json.dumps({'ok': True}))
        elif command == 'seed_completed':
            entries = payload.get('entries', [])
            count = seed_completed(conn, entries)
            print(json.dumps({'seeded': count}))
        elif command == 'seed_archived_files':
            entries = payload.get('entries', [])
            count = seed_archived_files(conn, entries)
            print(json.dumps({'seeded': count}))
        elif command == 'is_archived':
            print(json.dumps({'archived': is_archived(conn, payload['thread_id'])}))
        elif command == 'record_success':
            record_success(conn, payload)
            print(json.dumps({'ok': True}))
        elif command == 'record_failure':
            record_failure(conn, payload)
            print(json.dumps({'ok': True}))
        else:
            raise SystemExit(f'Unknown archive state command: {command}')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
`;

function inferArchiveSourceType(url) {
    const lowerUrl = String(url || '').toLowerCase();
    if (lowerUrl.includes('threadreaderapp.com/user/')) return 'threadreader_profile';
    if (lowerUrl.includes('threadreaderapp.com/thread/')) return 'threadreader_thread';
    if (lowerUrl.includes('x.com/') || lowerUrl.includes('twitter.com/')) return 'x_thread';
    return 'unknown';
}

function normalizeEntry(entry) {
    return {
        thread_id: String(entry.thread_id || '').trim(),
        source_url: String(entry.source_url || '').trim(),
        source_type: String(entry.source_type || inferArchiveSourceType(entry.source_url) || 'unknown').trim() || 'unknown',
        profile_url: entry.profile_url || null,
        content_hash: entry.content_hash || null,
        output_path: entry.output_path || null,
        error_message: entry.error_message || null,
        status: entry.status || 'archived',
        retry_count: Number.isFinite(entry.retry_count) ? entry.retry_count : parseInt(entry.retry_count || '0', 10) || 0,
        created_at: entry.created_at || new Date().toISOString(),
        updated_at: entry.updated_at || new Date().toISOString(),
        archived_at: entry.archived_at || null
    };
}

function normalizeAccountEntry(entry) {
    return {
        accountId: String(entry.accountId || entry.account_id || entry.handle || '').trim(),
        sourceUrl: String(entry.sourceUrl || entry.source_url || '').trim(),
        status: entry.status || 'checked',
        createdAt: entry.createdAt || entry.created_at || new Date().toISOString(),
        updatedAt: entry.updatedAt || entry.updated_at || new Date().toISOString(),
        lastError: entry.lastError || entry.last_error || null,
        resultSummary: entry.resultSummary || entry.result_summary || null,
        outputPath: entry.outputPath || entry.output_path || null,
        retryCount: Number.isFinite(entry.retryCount) ? entry.retryCount : parseInt(entry.retryCount || entry.retry_count || '0', 10) || 0,
    };
}

function runSqliteCommand(dbPath, command, payload = {}) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dl-archive-state-'));
    const payloadPath = path.join(tempDir, 'payload.json');
    fs.writeFileSync(payloadPath, JSON.stringify(payload), 'utf8');

    const result = spawnSync(PYTHON_COMMAND, ['-c', SQLITE_HELPER_PY, command, dbPath, payloadPath], {
        encoding: 'utf8'
    });

    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        const stderr = (result.stderr || '').trim();
        const stdout = (result.stdout || '').trim();
        throw new Error(stderr || stdout || `SQLite helper failed with exit code ${result.status}`);
    }

    const output = (result.stdout || '').trim();
    return output ? JSON.parse(output) : null;
}

function seedEntriesInChunks(dbPath, command, entries, chunkSize = 50) {
    if (!Array.isArray(entries) || entries.length === 0) return 0;

    let totalSeeded = 0;
    for (let index = 0; index < entries.length; index += chunkSize) {
        const chunk = entries.slice(index, index + chunkSize);
        const result = runSqliteCommand(dbPath, command, { entries: chunk });
        totalSeeded += result?.seeded || 0;
    }

    return totalSeeded;
}

class ArchiveStateStore {
    constructor(dbPath) {
        this.dbPath = dbPath;
    }

    init() {
        runSqliteCommand(this.dbPath, 'init');
    }

    seedLegacyCompletedThreads(filePath) {
        if (!fs.existsSync(filePath)) return 0;

        const urls = fs.readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#'));

        if (urls.length === 0) return 0;

        const entries = urls.map(url => ({
            thread_id: url.match(/\/(\d+)(?:\.html)?$/)?.[1] || url.split('?')[0].replace(/\/+$/, ''),
            source_url: url,
            source_type: inferArchiveSourceType(url),
            profile_url: null,
            archived_at: new Date().toISOString(),
            retry_count: 0
        })).filter(entry => entry.thread_id && entry.source_url);

        if (entries.length === 0) return 0;

        return seedEntriesInChunks(this.dbPath, 'seed_completed', entries);
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

        if (entries.length === 0) return 0;

        return seedEntriesInChunks(this.dbPath, 'seed_archived_files', entries);
    }

    isArchived(threadId) {
        if (!threadId) return false;
        const result = runSqliteCommand(this.dbPath, 'is_archived', { thread_id: String(threadId).trim() });
        return Boolean(result?.archived);
    }

    recordSuccess({ threadId, sourceUrl, sourceType, profileUrl = null, outputPath = null, contentHash = null }) {
        if (!threadId || !sourceUrl) {
            throw new Error('recordSuccess requires threadId and sourceUrl');
        }

        runSqliteCommand(this.dbPath, 'record_success', normalizeEntry({
            thread_id: threadId,
            source_url: sourceUrl,
            source_type: sourceType || inferArchiveSourceType(sourceUrl),
            profile_url: profileUrl,
            output_path: outputPath,
            content_hash: contentHash,
            status: 'archived',
            archived_at: new Date().toISOString()
        }));
    }

    recordFailure({ threadId, sourceUrl, sourceType, profileUrl = null, errorMessage = null, outputPath = null, contentHash = null }) {
        if (!threadId || !sourceUrl) {
            throw new Error('recordFailure requires threadId and sourceUrl');
        }

        runSqliteCommand(this.dbPath, 'record_failure', normalizeEntry({
            thread_id: threadId,
            source_url: sourceUrl,
            source_type: sourceType || inferArchiveSourceType(sourceUrl),
            profile_url: profileUrl,
            output_path: outputPath,
            content_hash: contentHash,
            error_message: errorMessage || 'Thread archiving failed',
            status: 'failed'
        }));
    }

}

module.exports = {
    ArchiveStateStore,
    inferArchiveSourceType
};