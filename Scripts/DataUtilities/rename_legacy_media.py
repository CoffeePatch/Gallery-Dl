#!/usr/bin/env python3
"""
Legacy Media Renamer Script
===========================
Renames legacy Twitter media files (without JSON metadata) into the project's
Canonical Naming Contract format:

Canonical Format:
    YYYY-MM-DD_HH-MM-SS_@account_SnowflakeID_MediaIdentifier.ext
"""

import os
import sys
import re
import random
import string
import argparse
import logging

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("LegacyRenamer")

# Pattern 1: <account>_<tweet_id>_<YYYY-MM-DD HH_MM_SS>.<ext>
LEGACY_P1 = re.compile(
    r"^(.+)_(\d{15,22})_(\d{4}-\d{2}-\d{2}\s+\d{2}_\d{2}_\d{2})\.([A-Za-z0-9]+)$"
)

# Pattern 2: <tweet_id>_<YYYY-MM-DD HH_MM_SS>_<num>_<media_id>.<ext>
LEGACY_P2 = re.compile(
    r"^(\d{15,22})_(\d{4}-\d{2}-\d{2}\s+\d{2}_\d{2}_\d{2})_\d+_([A-Za-z0-9_-]+)\.([A-Za-z0-9]+)$"
)

# Pattern 3: <tweet_id>_<YYYYMMDD>_<HHMMSS>_<num>_<media_id>.<ext>
LEGACY_P3 = re.compile(
    r"^(\d{15,22})_(\d{4}\d{2}\d{2})_(\d{2}\d{2}\d{2})_\d+_([A-Za-z0-9_-]+)\.([A-Za-z0-9]+)$"
)

# Strict Canonical Filename Regex
CANONICAL_MEDIA_REGEX = re.compile(
    r"^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})_@(.+)_(\d{15,22})_([A-Za-z0-9_-]+)\.([A-Za-z0-9]+)$"
)

MEDIA_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".mkv", ".webm"}
EXCLUDED_FOLDERS = {"Tweets", "Completed N", "FACEBOOK", "Mega_Account_01"}

def generate_random_media_id(length=6):
    """Generates a random alphanumeric string for MediaIdentifier."""
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length))

def parse_legacy_filename(fname, folder_handle):
    """Parses a legacy filename and returns (canonical_timestamp, clean_account, tweet_id, media_id, ext)."""
    m1 = LEGACY_P1.match(fname)
    if m1:
        raw_acc, tweet_id, date_raw, ext_name = m1.groups()
        clean_acc = folder_handle or raw_acc.strip().replace("@", "")
        parts = date_raw.split(" ")
        date_part = parts[0]
        time_part = parts[1].replace("_", "-") if len(parts) > 1 else "00-00-00"
        canonical_ts = f"{date_part}_{time_part}"
        media_id = generate_random_media_id(6)
        return canonical_ts, clean_acc, tweet_id, media_id, ext_name

    m2 = LEGACY_P2.match(fname)
    if m2:
        tweet_id, date_raw, orig_media_id, ext_name = m2.groups()
        clean_acc = folder_handle
        parts = date_raw.split(" ")
        date_part = parts[0]
        time_part = parts[1].replace("_", "-") if len(parts) > 1 else "00-00-00"
        canonical_ts = f"{date_part}_{time_part}"
        return canonical_ts, clean_acc, tweet_id, orig_media_id, ext_name

    m3 = LEGACY_P3.match(fname)
    if m3:
        tweet_id, ymd, hms, orig_media_id, ext_name = m3.groups()
        clean_acc = folder_handle
        date_part = f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:8]}"
        time_part = f"{hms[:2]}-{hms[2:4]}-{hms[4:6]}"
        canonical_ts = f"{date_part}_{time_part}"
        return canonical_ts, clean_acc, tweet_id, orig_media_id, ext_name

    return None

def process_directory(target_dir, dry_run=True):
    logger.info(f"Target Directory: {target_dir}")
    logger.info(f"Execution Mode:   {'DRY-RUN (Preview Mode)' if dry_run else 'LIVE RENAME MODE'}")
    
    if not os.path.exists(target_dir):
        logger.error(f"Target directory does not exist: {target_dir}")
        sys.exit(1)

    total_files = 0
    renamed_count = 0
    already_canonical_count = 0
    skipped_unrecognized_count = 0
    error_count = 0

    for dirpath, dirnames, filenames in os.walk(target_dir):
        # Prune excluded directories in-place so os.walk does not visit them at all
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_FOLDERS]
        folder_name = os.path.basename(dirpath)
        clean_folder_handle = folder_name.strip().replace("@", "")
        
        if folder_name in EXCLUDED_FOLDERS:
            continue

        for fname in filenames:
            if fname.endswith(".part") or fname.endswith(".cfg"):
                continue

            ext = os.path.splitext(fname)[1].lower()
            if ext not in MEDIA_EXTENSIONS:
                continue

            total_files += 1
            src_path = os.path.join(dirpath, fname)

            # Check if file is already canonical
            if CANONICAL_MEDIA_REGEX.match(fname):
                already_canonical_count += 1
                continue

            parse_result = parse_legacy_filename(fname, clean_folder_handle)
            if not parse_result:
                skipped_unrecognized_count += 1
                logger.debug(f"[SKIPPED] Unrecognized legacy pattern: {fname}")
                continue

            canonical_ts, clean_acc, tweet_id, media_id, ext_name = parse_result

            # Construct Canonical Filename
            canonical_name = f"{canonical_ts}_@{clean_acc}_{tweet_id}_{media_id}.{ext_name}"
            dest_path = os.path.join(dirpath, canonical_name)

            # Verify against strict Canonical Regex
            if not CANONICAL_MEDIA_REGEX.match(canonical_name):
                logger.error(f"[ERROR] Generated name failed canonical regex: {canonical_name}")
                error_count += 1
                continue

            if dry_run:
                if renamed_count < 10:
                    logger.info(f"[DRY-RUN] {fname} -> {canonical_name}")
            else:
                try:
                    os.rename(src_path, dest_path)
                except Exception as e:
                    logger.error(f"[ERROR] Failed to rename {fname}: {e}")
                    error_count += 1
                    continue

            renamed_count += 1

    logger.info("\n" + "=" * 50)
    logger.info("LEGACY MEDIA RENAME SUMMARY")
    logger.info(f"Total Media Files Evaluated:  {total_files}")
    logger.info(f"Files Renamed (or Previewed): {renamed_count}")
    logger.info(f"Already Canonical Files:      {already_canonical_count}")
    logger.info(f"Skipped Unrecognized Files:   {skipped_unrecognized_count}")
    logger.info(f"Errors Encountered:           {error_count}")
    logger.info("=" * 50 + "\n")

def main():
    parser = argparse.ArgumentParser(description="Rename Legacy Twitter Media Files to Canonical Contract Format")
    parser.add_argument(
        "--dir", "--root",
        dest="target_dir",
        type=str,
        default=r"c:\Users\hello\Pictures\Gallery-Dl\TweetData\Media\Tweets\Old Tweets\IND",
        help="Target root directory containing legacy media account subfolders"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview renames without modifying files on disk"
    )
    args = parser.parse_args()

    process_directory(args.target_dir, dry_run=args.dry_run)

if __name__ == "__main__":
    main()
