import sys
import json
import sqlite3
import os

if len(sys.argv) < 3:
    print("Usage: python sync_archive.py <jsonTargetFile> <userArchiveFile>")
    sys.exit(1)

json_file = sys.argv[1]
db_file = sys.argv[2]

if not os.path.exists(json_file):
    print(f"[SYNC] JSON file not found: {json_file}")
    sys.exit(0)

# Connect to sqlite db (creates the file if it doesn't exist)
conn = sqlite3.connect(db_file)
cursor = conn.cursor()

# Create table if not exists (gallery-dl standard format)
cursor.execute('''
    CREATE TABLE IF NOT EXISTS gallery_dl (
        extractor TEXT,
        id TEXT,
        PRIMARY KEY (extractor, id)
    )
''')

try:
    with open(json_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
except Exception as e:
    print(f"[SYNC] Failed to read JSON file: {e}")
    sys.exit(1)

count = 0
for record in data:
    # Ensure it's a valid record array
    if isinstance(record, list) and len(record) > 1:
        # Check if it's a Tweet metadata record (type 2)
        if record[0] == 2 and isinstance(record[1], dict) and 'tweet_id' in record[1]:
            tweet_id = str(record[1]['tweet_id'])
            # Insert the tweet ID so gallery-dl knows it has been processed
            cursor.execute("INSERT OR IGNORE INTO gallery_dl (extractor, id) VALUES (?, ?)", ('twitter', tweet_id))
            if cursor.rowcount > 0:
                count += 1

conn.commit()
conn.close()

if count > 0:
    print(f"[SYNC] Successfully inserted {count} new tweet IDs into archive for {os.path.basename(json_file)}.")
