import os
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.join(SCRIPT_DIR, '..', '..')
SYNC_SCRIPT_PATH = os.path.join(ROOT_DIR, 'Scripts', 'DataUtilities', 'sync_archive.py')

class TestSyncArchive(unittest.TestCase):
    def setUp(self):
        # Create temp files
        self.temp_json = tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode="w", encoding="utf-8")
        self.temp_db = tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite3")
        self.temp_db.close() # Close it so SQLite can open it

        # Write sample records to JSON
        sample_data = [
            [
                2,
                {
                    "tweet_id": 111111111,
                    "content": "Tweet 1"
                }
            ],
            [
                3,
                "https://example.com/img.jpg",
                {
                    "tweet_id": 111111111
                }
            ],
            [
                2,
                {
                    "tweet_id": 222222222,
                    "content": "Tweet 2"
                }
            ]
        ]
        json.dump(sample_data, self.temp_json)
        self.temp_json.close()

    def tearDown(self):
        # Remove temp files
        if os.path.exists(self.temp_json.name):
            os.remove(self.temp_json.name)
        if os.path.exists(self.temp_db.name):
            os.remove(self.temp_db.name)

    def test_sync_execution(self):
        # Run sync_archive.py
        cmd = [sys.executable, SYNC_SCRIPT_PATH, self.temp_json.name, self.temp_db.name]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        
        # Verify execution succeeded
        self.assertEqual(proc.returncode, 0)
        self.assertIn("[SYNC] Successfully inserted 2 new tweet IDs", proc.stdout)

        # Query the SQLite DB to ensure rows are inserted
        conn = sqlite3.connect(self.temp_db.name)
        cursor = conn.cursor()
        cursor.execute("SELECT extractor, id FROM gallery_dl")
        rows = cursor.fetchall()
        conn.close()

        # Expected: two inserts for tweets 111111111 and 222222222
        expected_rows = [('twitter', '111111111'), ('twitter', '222222222')]
        self.assertEqual(len(rows), 2)
        self.assertEqual(sorted(rows), sorted(expected_rows))

if __name__ == '__main__':
    unittest.main()
