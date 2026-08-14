import sys
import json
import sqlite3
import os

if len(sys.argv) < 2:
    print(json.dumps([]))
    sys.exit(0)

db_file = sys.argv[1]

if not os.path.exists(db_file):
    print(json.dumps([]))
    sys.exit(0)

try:
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    
    # Check if table exists before querying
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='gallery_dl'")
    if cursor.fetchone() is None:
        print(json.dumps([]))
        conn.close()
        sys.exit(0)
        
    cursor.execute("SELECT id FROM gallery_dl WHERE extractor='twitter'")
    rows = cursor.fetchall()
    ids = [str(row[0]) for row in rows]
    conn.close()
    print(json.dumps(ids))
except Exception as e:
    # Fail open on error
    print(json.dumps([]))
