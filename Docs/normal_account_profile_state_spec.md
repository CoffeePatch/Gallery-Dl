# Normal Account/Profile State Spec

## Purpose

Define one consistent state model for the normal X/Twitter account/profile path so that input, progress, and archived output are not split across unrelated text files, CSVs, and SQLite state. The current implementation already uses a mix of `users.txt`, `results.csv`, and SQLite-backed archive state; this spec describes the unified behavior the developer should aim for.

## Scope

- In scope: normal account/profile checks, archive/download processing, resume behavior, duplicate suppression, and failure tracking.
- Out of scope: Instagram flows, thread-only one-off scripts, and UI work.

## Data Model

Use SQLite as the source of truth for per-account/profile state.

- `account_state` table
  - `account_id` or canonical handle as the primary key.
  - `source_url` for the original input record.
  - `status` with values such as `pending`, `processing`, `checked`, `archived`, `failed`, and `blocked`.
  - `updated_at`, `created_at`, and optional `last_error`.
  - `result_summary` for status-check output such as active/suspended/does-not-exist.
  - `archive_path` or `output_path` for downloaded output.
- `account_state_events` table
  - Append-only history of attempts, retries, and failures.
  - Useful for debugging auth failures, rate limits, and partial runs.

Keep file-based inputs and outputs as derivatives only.

- Input queue: `Config/Users/users.txt`
- Human-readable status log: `TweetData/AccountStatus/results.csv`
- Legacy skip files: keep only for backward compatibility, not as authoritative state.

## Workflow

1. Load `users.txt` and normalize each line to a canonical account/profile identifier.
2. Read SQLite state first and skip any account already marked complete or archived.
3. For account checks, write the latest result to SQLite, then mirror a readable row to `results.csv`.
4. For archive/download runs, mark the account `processing`, run the scraper, then record success or failure in SQLite.
5. On success, update the output path, timestamps, and terminal status in SQLite.
6. On failure, increment retry metadata and persist the error message for later recovery.
7. Treat `results.csv` and any legacy text queues as generated artifacts, not the source of truth.

## Failure Handling

- Auth redirects or session loss should move the account to a recoverable failure state, not silently skip it.
- Rate limits and browser timeouts should be stored in event history and should not erase prior successful state.
- A partial run must be resumable without reprocessing already completed accounts.
- Manual file edits should not break the authoritative state if SQLite remains intact.

## Acceptance Criteria

- A single SQLite database can resume both status-check and archive runs without relying on CSV/TXT files for correctness.
- Re-running the workflow after interruption does not duplicate completed accounts.
- Status-check output remains readable in CSV form, but the database is the system of record.
- Archive completion and status-check completion are represented as distinct states, not overloaded into one skip file.
- Deleting or moving a CSV/TXT artifact does not cause the canonical account state to be lost.
- The workflow can explain why an account was skipped, failed, or retried from persisted state alone.

## Suggested Implementation Notes

- Keep `users.txt` as the only manual input list.
- Reuse the existing SQLite archive pattern in `Scripts/lib/archiveState.js` as the model for account/profile state.
- Avoid adding new skip files unless they are strictly derived from SQLite for legacy compatibility.
- If the existing `results.csv` format must remain, treat it as a write-through log.
