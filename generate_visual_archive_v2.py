#!/usr/bin/env python3
"""
Root Forwarder for Tweet Visual Archive Generator v2 (HTML Timeline Input)
===========================================================================
Delegates execution to: Scripts/SnapshotRenderer/generate_visual_archive_v2.py
"""

import os
import sys
import subprocess

def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    target_script = os.path.join(root_dir, "Scripts", "SnapshotRenderer", "generate_visual_archive_v2.py")
    cmd = [sys.executable, target_script] + sys.argv[1:]
    res = subprocess.run(cmd)
    sys.exit(res.returncode)

if __name__ == "__main__":
    main()
