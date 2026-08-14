#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { ArchiveStateStore } = require('../lib/archiveState');

function main() {
  const [, , dbPath, command, payloadPath] = process.argv;
  if (!dbPath || !command || !payloadPath) {
    console.error('Usage: node account_state_cli.js <dbPath> <command> <payloadJsonPath>');
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const store = new ArchiveStateStore(dbPath);
  store.init();

  switch (command) {
    case 'should_process_account': {
      const accountId = payload.account_id || payload.accountId;
      console.log(JSON.stringify({ should_process: store.shouldProcessAccount(accountId) }));
      break;
    }
    case 'record_account_processing': {
      store.recordAccountProcessing({
        accountId: payload.account_id || payload.accountId,
        sourceUrl: payload.source_url || payload.sourceUrl,
        resultSummary: payload.result_summary || payload.resultSummary,
        outputPath: payload.output_path || payload.outputPath,
      });
      console.log(JSON.stringify({ ok: true }));
      break;
    }
    case 'record_account_check': {
      store.recordAccountCheck({
        accountId: payload.account_id || payload.accountId,
        sourceUrl: payload.source_url || payload.sourceUrl,
        resultSummary: payload.result_summary || payload.resultSummary,
        outputPath: payload.output_path || payload.outputPath,
      });
      console.log(JSON.stringify({ ok: true }));
      break;
    }
    case 'record_account_failure': {
      store.recordAccountFailure({
        accountId: payload.account_id || payload.accountId,
        sourceUrl: payload.source_url || payload.sourceUrl,
        errorMessage: payload.error_message || payload.errorMessage,
        resultSummary: payload.result_summary || payload.resultSummary,
        outputPath: payload.output_path || payload.outputPath,
      });
      console.log(JSON.stringify({ ok: true }));
      break;
    }
    default:
      console.error(`Unknown account state command: ${command}`);
      process.exit(1);
  }
}

main();
