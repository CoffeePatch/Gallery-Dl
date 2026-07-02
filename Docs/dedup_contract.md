# Record Deduplication Keys Contract

This document specifies the canonical contract for record deduplication keys across the Node.js (JavaScript) and Python components in the `gallery-dl-suite` workspace.

---

## 1. Specification

To ensure that the Node.js merges (`json_merger.js`) and Python merges (`merge_raw_folders.py`) are 100% consistent and do not cause data drift, both implementations must derive deduplication keys identically.

### Rules:
1. **Type 2 (Metadata) Records**:
   - Condition: Record is a list where `record[0] === 2`, or it is a flat object containing `tweet_id` or `id_str` (without a media URL).
   - Key: `'2_' + tweet_id` (where `tweet_id` is converted to a string).
2. **Type 3 (Resource URL) Records**:
   - Condition: Record is a list where `record[0] === 3`, or it is a flat object containing a media URL.
   - Key: `'3_' + media_url` (where `media_url` is the direct URL string).
3. **Unknown/Other Records**:
   - Fallback: Deterministic stringification of the JSON representation (e.g. `JSON.stringify(record)` in JS / `json.dumps(record, sort_keys=True)` in Python).

---

## 2. Implementations

### Node.js (JavaScript)
The parsing and key generation are centralized in [recordSchema.js](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/lib/recordSchema.js):

```javascript
function getRecordKey(record) {
    const parsed = parseRecord(record);
    if (parsed.isLegacy && parsed.tweetId) {
        return '2_' + parsed.tweetId;
    } else if (parsed.isMedia && parsed.mediaUrl) {
        return '3_' + parsed.mediaUrl;
    } else {
        return JSON.stringify(record);
    }
}
```

### Python
In [merge_raw_folders.py](file:///c:/Users/hello/Pictures/Gallery-Dl/Scripts/merge_raw_folders.py):

```python
def get_record_key(record):
    if isinstance(record, list) and len(record) > 1:
        if record[0] == 2 and isinstance(record[1], dict) and 'tweet_id' in record[1]:
            return '2_' + str(record[1]['tweet_id'])
        elif record[0] == 3 and isinstance(record[1], str):
            return '3_' + record[1]
    elif isinstance(record, dict):
        tweet_id = record.get('tweet_id') or record.get('id_str')
        media_url = record.get('url') or record.get('media_url_https') or record.get('media_url')
        if tweet_id and not media_url:
            return '2_' + str(tweet_id)
        elif media_url:
            return '3_' + media_url
    return json.dumps(record)
```

---

## 3. Shared Verification Fixture

A test fixture containing standard array/object records is defined under `Config/test_fixtures/sample_records.json`.
Both JavaScript and Python test runners must assert that they map this sample dataset to the identical set of deduplication keys.
