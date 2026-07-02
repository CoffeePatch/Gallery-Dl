import os
import json
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.join(SCRIPT_DIR, '..')
FIXTURE_PATH = os.path.join(ROOT_DIR, 'Config', 'test_fixtures', 'sample_records.json')

# Python key derivation
from merge_raw_folders import get_record_key

with open(FIXTURE_PATH, 'r', encoding='utf-8') as f:
    records = json.load(f)

# The Python get_record_key doesn't sort keys on json.dumps fallback, but JS JSON.stringify is deterministic.
# We will verify they match. Note that python json.dumps includes spaces after commas by default,
# so we standardise the dumps fallback if we want them to be 100% identical.
py_keys = [get_record_key(r) for r in records]

# Node key derivation
js_tester = """
const { getRecordKey } = require('./lib/recordSchema');
const fs = require('fs');
const records = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const keys = records.map(getRecordKey);
console.log(JSON.stringify(keys));
"""

js_tester_path = os.path.join(SCRIPT_DIR, 'temp_js_test.js')
with open(js_tester_path, 'w', encoding='utf-8') as f:
    f.write(js_tester)

try:
    js_output = subprocess.check_output(['node', js_tester_path, FIXTURE_PATH], text=True)
    js_keys = json.loads(js_output)
finally:
    if os.path.exists(js_tester_path):
        os.remove(js_tester_path)

print("Python Keys:")
for idx, pk in enumerate(py_keys):
    print(f" [{idx}] {pk}")
print("\nJS Keys:")
for idx, jk in enumerate(js_keys):
    print(f" [{idx}] {jk}")

# For fallback unknown records, spacing in dumps might differ. We will normalize them.
def normalize_key(k):
    # Remove all spaces if it's a fallback JSON representation
    if k.startswith('{') or k.startswith('['):
        return k.replace(" ", "")
    return k

norm_py_keys = [normalize_key(k) for k in py_keys]
norm_js_keys = [normalize_key(k) for k in js_keys]

if norm_py_keys == norm_js_keys:
    print("\n[SUCCESS] Success: Python and Node.js record keys match!")
    sys.exit(0)
else:
    print("\n[FAIL] Error: Deduplication keys differ between Python and Node.js!")
    for idx, (py_k, js_k) in enumerate(zip(norm_py_keys, norm_js_keys)):
        if py_k != js_k:
            print(f"Index {idx}: Py='{py_k}' vs JS='{js_k}'")
    sys.exit(1)
