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

test('tracks account processing, checks, and failures in account_state table', () => {
  const { dbPath } = makeTempPaths('account-tracking');
  const store = new ArchiveStateStore(dbPath);
  store.init();

  assert.equal(store.shouldProcessAccount('user_1'), true);

  store.recordAccountProcessing({
    accountId: 'user_1',
    sourceUrl: 'https://x.com/user_1'
  });
  assert.equal(store.shouldProcessAccount('user_1'), false);

  store.recordAccountCheck({
    accountId: 'user_1',
    sourceUrl: 'https://x.com/user_1',
    resultSummary: 'Success'
  });
  assert.equal(store.shouldProcessAccount('user_1'), true);

  store.recordAccountFailure({
    accountId: 'user_2',
    sourceUrl: 'https://x.com/user_2',
    errorMessage: 'Account suspended'
  });
  assert.equal(store.shouldProcessAccount('user_2'), true);
});

test('account_state_cli executes commands using payload JSON file', () => {
  const { dir, dbPath } = makeTempPaths('cli-test');
  const cliPath = path.join(__dirname, '..', 'AccountBatchProcessing', 'account_state_cli.js');

  const store = new ArchiveStateStore(dbPath);
  store.init();

  const payloadFile = path.join(dir, 'payload.json');
  fs.writeFileSync(payloadFile, JSON.stringify({
    account_id: 'cli_user',
    source_url: 'https://x.com/cli_user',
    result_summary: 'CLI check OK'
  }), 'utf8');

  const { execFileSync } = require('child_process');

  // Test should_process_account
  const output1 = execFileSync(process.execPath, [cliPath, dbPath, 'should_process_account', payloadFile], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output1), { should_process: true });

  // Test record_account_processing
  const output2 = execFileSync(process.execPath, [cliPath, dbPath, 'record_account_processing', payloadFile], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output2), { ok: true });

  const output3 = execFileSync(process.execPath, [cliPath, dbPath, 'should_process_account', payloadFile], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output3), { should_process: false });

  // Test record_account_check
  const output4 = execFileSync(process.execPath, [cliPath, dbPath, 'record_account_check', payloadFile], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output4), { ok: true });

  // Test record_account_failure
  const output5 = execFileSync(process.execPath, [cliPath, dbPath, 'record_account_failure', payloadFile], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output5), { ok: true });
});

