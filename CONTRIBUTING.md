# Contributing to Gallery-Dl Scraper Suite

Thank you for considering contributing to this project! To maintain the architecture and stability of this suite, please adhere to the following guidelines:

## Directory Structure
- All code/scripts should reside under [Scripts/](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/).
- Configuration targets, user queues, and cookies belong in [Config/](file:///c:/Users/hello/Pictures/Gallery-Dl/Config/).
- Downloaded assets and timelines belong in [TweetData/](file:///c:/Users/hello/Pictures/Gallery-Dl/TweetData/).

## Architectural Standards
1. **Never Hardcode Secrets**: Extract active API parameters dynamically (e.g. bearer tokens) or store them under `Config/`.
2. **Never Duplicate Paths**: Always import directory paths from the shared [paths.js](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/lib/paths.js) config.
3. **Uniform Record Parsing**: Standardize all JSON timeline records using the shared [recordSchema.js](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/lib/recordSchema.js) library.
4. **Reliable Network Downloads**: Use the centralized [download.js](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/lib/download.js) module (`downloadWithRetry`) for any network fetch requests.
5. **Centralized Rate Limiting**: All pacing, polling, or backoff timing values must be imported from [rateLimits.js](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/lib/rateLimits.js).

## Running & Adding Tests
Before submitting any changes, make sure you execute the test pipeline and that all tests pass:
```bash
npm test
```
- Node.js unit tests are stored in [unit_tests.test.js](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/tests/unit_tests.test.js) (using the native `node:test` framework).
- Python database integration tests live in [test_sync.py](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/tests/test_sync.py) (using Python's native `unittest` framework).
- Cross-language key parity is asserted via [test_dedup_keys.py](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/test_dedup_keys.py).
