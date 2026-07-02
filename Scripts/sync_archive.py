import sys
import json
import sqlite3
import os
import argparse

parser = argparse.ArgumentParser(description="Sync tweet IDs from gallery-dl JSON into a SQLite archive.")
parser.add_argument("json_file", help="Path to the gallery-dl JSON file (must end with .json)")
parser.add_argument("db_file", help="Path to the user SQLite archive file (must end with .sqlite3 or .db)")

args = parser.parse_args()

json_file = args.json_file
db_file = args.db_file

# Pre-flight validation
if not json_file.lower().endswith('.json'):
    print("[SYNC ERROR] JSON file path must end with .json", file=sys.stderr)
    sys.exit(1)

if not (db_file.lower().endswith('.sqlite3') or db_file.lower().endswith('.db')):
    print("[SYNC ERROR] DB file path must end with .sqlite3 or .db", file=sys.stderr)
    sys.exit(1)

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
