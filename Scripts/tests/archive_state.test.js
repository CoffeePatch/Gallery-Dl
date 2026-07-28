const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ArchiveStateStore } = require('../lib/archiveState');

function makeTempPaths(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return {
    dir,
    dbPath: path.join(dir, 'archive_state.sqlite3'),
    completedPath: path.join(dir, 'completed_threads.txt')
  };
}

test('records successful thread archives as archived in SQLite', () => {
  const { dbPath } = makeTempPaths('archive-success');
  const store = new ArchiveStateStore(dbPath);

  store.init();
  store.recordSuccess({
    threadId: '12345',
    sourceUrl: 'https://x.com/i/status/12345',
    sourceType: 'x_thread',
    outputPath: '/tmp/12345.html'
  });

  assert.equal(store.isArchived('12345'), true);
});

test('seeds legacy completed thread files into archived state', () => {
  const { dbPath, completedPath } = makeTempPaths('archive-seed');
  fs.writeFileSync(completedPath, 'https://x.com/i/status/777\n', 'utf8');

  const store = new ArchiveStateStore(dbPath);
  store.init();
  const seeded = store.seedLegacyCompletedThreads(completedPath);

  assert.equal(seeded, 1);
  assert.equal(store.isArchived('777'), true);
});

test('seeds existing html archives from nested folders', () => {
  const { dir, dbPath } = makeTempPaths('archive-files');
  const nestedDir = path.join(dir, 'nested', 'deeper');
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(path.join(nestedDir, '1848105743955718351_threadR.html'), '<html></html>', 'utf8');

  const store = new ArchiveStateStore(dbPath);
  store.init();
  const seeded = store.seedExistingArchiveFiles(dir);

  assert.equal(seeded, 1);
  assert.equal(store.isArchived('1848105743955718351'), true);
});

test('stores thread archive state independently from legacy completion files', () => {
  const { dbPath } = makeTempPaths('account-state');
  const store = new ArchiveStateStore(dbPath);

  store.init();
  store.recordSuccess({
    threadId: 'alice',
    sourceUrl: 'https://x.com/alice',
    sourceType: 'x_thread',
    outputPath: '/tmp/alice.json'
  });

  assert.equal(store.isArchived('alice'), true);

  store.recordFailure({
    threadId: 'bob',
    sourceUrl: 'https://x.com/bob',
    sourceType: 'x_thread',
    errorMessage: 'Rate limit exceeded'
  });

  assert.equal(store.isArchived('bob'), false);
});
