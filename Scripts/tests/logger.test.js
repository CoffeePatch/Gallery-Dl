const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { logInfo, logWarn, logError, logSubprocessExit, LOG_FILE } = require('../lib/logger');

test('logger - creates log file and appends structured entries', () => {
    logInfo('Test Info Message', { key: 'value' });
    logWarn('Test Warning Message');
    logError('Test Error Message', new Error('Mock error'));
    logSubprocessExit('gallery-dl', 1, 'Mock stderr output');

    assert.ok(fs.existsSync(LOG_FILE), 'Log file should exist');
    const logContent = fs.readFileSync(LOG_FILE, 'utf8');

    assert.ok(logContent.includes('[INFO] Test Info Message'), 'Log file should contain INFO entry');
    assert.ok(logContent.includes('[WARN] Test Warning Message'), 'Log file should contain WARN entry');
    assert.ok(logContent.includes('[ERROR] Test Error Message'), 'Log file should contain ERROR entry');
    assert.ok(logContent.includes("Subprocess 'gallery-dl' exited with code 1"), 'Log file should contain subprocess exit code');
});
