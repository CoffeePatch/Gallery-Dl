import os
import json
import shutil
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.join(SCRIPT_DIR, '..')
NEW_RAW_DIR = os.path.join(ROOT_DIR, 'TweetData', 'NewRawData')
RAW_DIR = os.path.join(ROOT_DIR, 'TweetData', 'RawData')
ACCOUNT_STATUS_DIR = os.path.join(ROOT_DIR, 'TweetData', 'AccountStatus')
SYNC_SCRIPT = os.path.join(SCRIPT_DIR, 'sync_archive.py')

def get_record_key(record):
    if isinstance(record, list) and len(record) > 1:
        if record[0] == 2 and isinstance(record[1], dict) and 'tweet_id' in record[1]:
            return '2_' + str(record[1]['tweet_id'])
        elif record[0] == 3 and isinstance(record[1], str):
            return '3_' + record[1]
    return json.dumps(record)

def merge_json_files(new_file, old_file, target_file):
    try:
        with open(new_file, 'r', encoding='utf-8') as f:
            new_records = json.load(f)
    except Exception as e:
        print(f"Error reading {new_file}: {e}")
        new_records = []
        
    try:
        with open(old_file, 'r', encoding='utf-8') as f:
            old_records = json.load(f)
    except Exception as e:
        print(f"Error reading {old_file}: {e}")
        old_records = []

    if not isinstance(new_records, list):
        new_records = []
    if not isinstance(old_records, list):
        old_records = []

    all_records = new_records + old_records
    combined = []
    seen = set()
    
    for record in all_records:
        key = get_record_key(record)
        if key not in seen:
            seen.add(key)
            combined.append(record)
            
    with open(target_file, 'w', encoding='utf-8') as f:
        json.dump(combined, f, indent=2)
        
    return len(new_records), len(old_records), len(combined)

def run_sync(json_path):
    filename = os.path.basename(json_path)
    clean_username = filename.replace('_tweets.json', '')
    sqlite_path = os.path.join(ACCOUNT_STATUS_DIR, f"{clean_username}_archive.sqlite3")
    
    try:
        subprocess.run(["python", SYNC_SCRIPT, json_path, sqlite_path], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        print(f"Failed to run sync script for {filename}: {e}")

if not os.path.exists(NEW_RAW_DIR):
    print(f"Folder not found: {NEW_RAW_DIR}")
    exit(0)

if not os.path.exists(RAW_DIR):
    os.makedirs(RAW_DIR)

print("Starting merge process. Files will NOT be deleted from NewRawData.")
print("-" * 50)

merged_count = 0
copied_count = 0

for filename in os.listdir(NEW_RAW_DIR):
    if not filename.endswith('_tweets.json'):
        continue
        
    new_path = os.path.join(NEW_RAW_DIR, filename)
    target_path = os.path.join(RAW_DIR, filename)
    
    if os.path.exists(target_path):
        # Merge
        print(f"Merging: {filename}...")
        n_len, o_len, c_len = merge_json_files(new_path, target_path, target_path)
        duplicates = (n_len + o_len) - c_len
        print(f"  -> Added {n_len} records to {o_len} existing. Removed {duplicates} duplicates. New Total: {c_len}")
        merged_count += 1
    else:
        # Copy
        print(f"Copying unique file: {filename}...")
        shutil.copy2(new_path, target_path)
        copied_count += 1
        
    # Sync SQLite
    run_sync(target_path)

print("-" * 50)
print(f"Process complete!")
print(f"Merged {merged_count} overlapping files.")
print(f"Copied {copied_count} unique files.")
print("\nEverything has been successfully unified into the RawData folder.")
print("The NewRawData folder has been left completely intact. You may review and delete it manually.")
