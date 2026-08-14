const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./paths');

const LOGS_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'suite.log');

function ensureLogDirectory() {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}

function appendToLog(level, message, detail = null) {
    try {
        ensureLogDirectory();
        const timestamp = new Date().toISOString();
        let logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        if (detail) {
            logLine += ` | Detail: ${typeof detail === 'object' ? JSON.stringify(detail) : detail}`;
        }
        logLine += '\n';
        fs.appendFileSync(LOG_FILE, logLine, 'utf8');
    } catch (err) {
        // Fallback to console if file logging fails
        console.error(`[Logger Error] Failed to write to ${LOG_FILE}:`, err.message);
    }
}

function logInfo(message, detail = null) {
    console.log(`[INFO] ${message}`);
    appendToLog('INFO', message, detail);
}

function logWarn(message, detail = null) {
    console.warn(`[WARN] ${message}`);
    appendToLog('WARN', message, detail);
}

function logError(message, error = null) {
    const errStr = error ? (error.stack || error.message || String(error)) : null;
    console.error(`[ERROR] ${message}`, errStr || '');
    appendToLog('ERROR', message, errStr);
}

function logSubprocessExit(commandName, exitCode, stderrOutput = '') {
    const isSuccess = exitCode === 0;
    const level = isSuccess ? 'INFO' : 'ERROR';
    const msg = `Subprocess '${commandName}' exited with code ${exitCode}`;
    if (!isSuccess) {
        console.error(`[Subprocess Error] ${msg}`);
        if (stderrOutput) {
            console.error(`[Subprocess Stderr] ${stderrOutput.trim()}`);
        }
    } else {
        console.log(`[Subprocess] ${msg}`);
    }
    appendToLog(level, msg, stderrOutput ? stderrOutput.trim() : null);
}

module.exports = {
    logInfo,
    logWarn,
    logError,
    logSubprocessExit,
    LOG_FILE,
    LOGS_DIR
};
