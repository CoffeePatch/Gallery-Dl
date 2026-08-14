#!/usr/bin/env python3
"""
Bulk Tweet Visual Archive Generator (Browser-Free WebP Snapshot Renderer)
========================================================================
Converts Gallery-DL JSON metadata and locally available canonical media files
into WebP visual snapshots.

Architecture:
  JSON metadata + Local canonical media -> Native SVG -> resvg-py -> Pillow -> WebP

Features:
  - Pure SVG <text>/<tspan> layout with explicit text wrapping.
  - 100% browser-free (zero Chrome/Playwright/Selenium dependencies).
  - Strictly READ-ONLY on source data (No copying, renaming, downloading, or moving).
  - O(1) canonical media indexing built once per run.
  - Media-aware resumability manifest (.snapshot_manifest.json): Auto-regenerates
    snapshots when newly downloaded media becomes available.
  - Optimized image preprocessing (direct raw-byte embedding for sub-1800px images).
  - Strict canonical filename parsing supporting account handles with underscores.
  - Configurable WebP encoding parameters and concurrency.
  - Detailed status classification & performance instrumentation.
"""

import os
import sys
import json
import re
import logging
import argparse
import time
import io
import base64
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

# Third-party dependencies
try:
    from PIL import Image
except ImportError as e:
    print(f"CRITICAL ERROR: Required package missing ({e}). Run: pip install pillow")
    sys.exit(1)

try:
    import resvg_py
except ImportError as e:
    print(f"CRITICAL ERROR: Required package missing ({e}). Run: pip install resvg-py")
    sys.exit(1)

try:
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

# Default Paths & Constants
DEFAULT_BASE_DIR = r"C:\Users\hello\Pictures\Gallery-Dl\TweetData"
DEFAULT_MEDIA_DIR = os.path.join(DEFAULT_BASE_DIR, "Media")
DEFAULT_RAW_DIR = os.path.join(DEFAULT_BASE_DIR, "RawData")
DEFAULT_OUT_DIR = None  # None = generate WebP files in the same folders as original media files
EXCLUDED_DIRS = {"Tweets", "tweets", "Completed N", "FACEBOOK", "Mega_Account_01", "Mappings", "Completed"}

# Strict Canonical Filename Regex (Handles account handles with underscores & 15-22 digit Snowflake IDs)
# Format: YYYY-MM-DD_HH-MM-SS_@account_SnowflakeID_MediaIdentifier.ext
CANONICAL_MEDIA_REGEX = re.compile(
    r"^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})_@(.+)_(\d{15,22})_([A-Za-z0-9_-]+)\.([A-Za-z0-9]+)$"
)

# Generated Snapshot WebP Filename Regex (Format: YYYY-MM-DD_HH-MM-SS_@account_SnowflakeID.webp)
SNAPSHOT_FILENAME_REGEX = re.compile(
    r"^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})_@(.+)_(\d{15,22})\.webp$"
)

# Setup Logger
logger = logging.getLogger("VisualArchive")

def setup_logging(log_file=None, verbose=False):
    level = logging.DEBUG if verbose else logging.INFO
    logger.setLevel(level)
    handlers = [logging.StreamHandler(sys.stdout)]
    if log_file:
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
    
    formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
    for h in handlers:
        h.setFormatter(formatter)
        logger.addHandler(h)

def sanitize_filename(name):
    """Sanitize string for Windows filename safety."""
    if not name:
        return "unknown"
    sanitized = re.sub(r'[\ \/\:\*\?\"\<\>\|]', '_', str(name))
    sanitized = sanitized.strip(". ")
    return sanitized or "unknown"

def parse_date_string(date_str):
    """Parse JSON date string into (YYYY-MM-DD_HH-MM-SS, datetime_obj, formatted_display_date)."""
    if not date_str:
        return None, None, "12:00 PM · Jan 01, 2026"
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(str(date_str)[:19], fmt[:19])
            fn_date = dt.strftime("%Y-%m-%d_%H-%M-%S")
            disp_date = dt.strftime("%I:%M %p · %b %d, %Y")
            return fn_date, dt, disp_date
        except Exception:
            continue
    return None, None, str(date_str)

def extract_date_from_filename(filename):
    """Fallback date parser from canonical media filename."""
    m = CANONICAL_MEDIA_REGEX.match(filename)
    if m:
        return m.group(1)
    m_old = re.match(r"^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})_", filename)
    if m_old:
        return m_old.group(1)
    return "1970-01-01_00-00-00"

def format_number(num):
    """Format counts (1.2K, 452K, 1.5M)."""
    if num is None:
        return "0"
    try:
        val = float(num)
        if val >= 1000000:
            return f"{val/1000000:.1f}".rstrip('0').rstrip('.') + "M"
        if val >= 1000:
            return f"{val/1000:.1f}".rstrip('0').rstrip('.') + "K"
        return str(int(val))
    except Exception:
        return str(num)

def escape_xml(text):
    """Escape text for XML/SVG rendering."""
    if not text:
        return ""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )

def has_meaningful_text(text):
    """
    Check if text contains meaningful words/letters/digits (Unicode-aware).
    Returns False for empty text or text consisting solely of emojis, symbols, and punctuation.
    """
    if not text:
        return False
    # \w matches any alphanumeric character across all Unicode scripts (Latin, Telugu, Hindi, Tamil, CJK, etc.)
    return bool(re.search(r'\w', str(text)))

def wrap_text_to_svg_lines(text, max_chars=50):
    """
    Explicitly wraps text into lines for native SVG <tspan> rendering.
    Preserves explicit newlines and handles long words.
    """
    if not text:
        return []
    raw_lines = str(text).split("\n")
    wrapped_lines = []
    
    for raw_line in raw_lines:
        if not raw_line.strip():
            wrapped_lines.append("")
            continue
        words = raw_line.split(" ")
        current_line = []
        current_len = 0
        
        for word in words:
            w_len = len(word)
            if w_len > max_chars:
                if current_line:
                    wrapped_lines.append(" ".join(current_line))
                    current_line = []
                    current_len = 0
                for i in range(0, w_len, max_chars):
                    chunk = word[i:i+max_chars]
                    if i + max_chars >= w_len:
                        current_line.append(chunk)
                        current_len = len(chunk)
                    else:
                        wrapped_lines.append(chunk)
                continue

            if current_len + w_len + (1 if current_line else 0) <= max_chars:
                current_line.append(word)
                current_len += w_len + (1 if len(current_line) > 1 else 0)
            else:
                wrapped_lines.append(" ".join(current_line))
                current_line = [word]
                current_len = w_len
                
        if current_line:
            wrapped_lines.append(" ".join(current_line))
            
    return wrapped_lines

def build_media_index(media_dir):
    """
    Scans media_dir ONCE and builds O(1) lookup tables for canonical filenames:
    - Primary index: (tweet_id_str, media_identifier_str) -> absolute_path
    - Fallback index: media_identifier_str -> absolute_path
    Detects and logs duplicate media key collisions and non-canonical files.
    """
    t0 = time.perf_counter()
    media_index = {}
    fallback_index = {}
    collisions = 0
    non_canonical_files = 0
    
    if not os.path.exists(media_dir):
        return media_index, fallback_index, collisions, non_canonical_files, 0.0

    for fname in os.listdir(media_dir):
        fpath = os.path.join(media_dir, fname)
        if not os.path.isfile(fpath):
            continue

        # Skip manifest files, hidden files, and generated WebP snapshot files from media indexing
        if fname.startswith(".") or fname.endswith(".json") or SNAPSHOT_FILENAME_REGEX.match(fname):
            continue

        match = CANONICAL_MEDIA_REGEX.match(fname)
        if match:
            dt_str, account, tid_str, media_id, ext = match.groups()
            key = (tid_str, media_id)

            if key in media_index:
                collisions += 1
                logger.warning(f"[DUPLICATE_MEDIA_KEY] Collision detected for key {key}: '{media_index[key]}' vs '{fpath}'")
            else:
                media_index[key] = fpath

            if media_id not in fallback_index:
                fallback_index[media_id] = fpath
        else:
            non_canonical_files += 1
            logger.warning(f"[NON_CANONICAL_MEDIA_FILE] Skipping non-canonical file in media directory: '{fname}'")

    elapsed = time.perf_counter() - t0
    return media_index, fallback_index, collisions, non_canonical_files, elapsed

def get_image_dimensions_and_b64(file_path, is_video=False, max_dim=1800, timer_stats=None):
    """
    Extracts uncropped dimensions and Base64 Data URI for image or video poster.
    Optimized: Uses raw byte reading for sub-1800px images to avoid unnecessary PIL decode/encode cycles.
    """
    default_dims = {"width": 800, "height": 1080, "aspect": 800.0 / 1080.0, "b64": ""}
    if not file_path or not os.path.exists(file_path):
        return default_dims

    try:
        if is_video:
            t0 = time.perf_counter()
            if HAS_OPENCV:
                cap = cv2.VideoCapture(file_path)
                if cap.isOpened():
                    cap.set(cv2.CAP_PROP_POS_MSEC, 100)
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        ret, frame = cap.read()
                    cap.release()

                    if ret and frame is not None:
                        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                        with Image.fromarray(frame_rgb) as img:
                            w, h = img.size
                            img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
                            buf = io.BytesIO()
                            img.save(buf, format="JPEG", quality=95)
                            b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
                            if timer_stats is not None:
                                timer_stats.add("video_poster_extraction", time.perf_counter() - t0)
                            return {"width": w, "height": h, "aspect": float(w) / float(h) if h else 1.0, "b64": b64}

            if timer_stats is not None:
                timer_stats.add("video_poster_extraction", time.perf_counter() - t0)
            return default_dims

        # Standard Image Processing (Fast Path vs Resizing Fallback)
        t0 = time.perf_counter()
        with Image.open(file_path) as img:
            w, h = img.size
            fmt = (img.format or "JPEG").upper()

        aspect = float(w) / float(h) if h else 1.0

        # Fast Path: If image fits within max_dim and is in standard SVG-supported format (JPEG/PNG/WEBP)
        if max(w, h) <= max_dim and fmt in ("JPEG", "JPG", "PNG", "WEBP"):
            mime_type = "jpeg" if fmt in ("JPEG", "JPG") else fmt.lower()
            with open(file_path, "rb") as f:
                raw_bytes = f.read()
            b64 = f"data:image/{mime_type};base64," + base64.b64encode(raw_bytes).decode("ascii")
            if timer_stats is not None:
                timer_stats.add("image_preprocessing", time.perf_counter() - t0)
            return {"width": w, "height": h, "aspect": aspect, "b64": b64}

        # Fallback Path: Full decode and LANCZOS resize for oversized images or non-standard formats
        with Image.open(file_path) as img:
            img_conv = img.convert("RGB")
            img_conv.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            img_conv.save(buf, format="JPEG", quality=95)
            b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

        if timer_stats is not None:
            timer_stats.add("image_preprocessing", time.perf_counter() - t0)
        return {"width": w, "height": h, "aspect": aspect, "b64": b64}

    except Exception as e:
        logger.debug(f"Failed to process media file {file_path}: {e}")
        return default_dims

def render_freed_dimensions_media_section(processed_items, media_y, tid_str):
    """
    Renders 100% UNCROPPED FREED-DIMENSION Media Grids:
    - Heights calculated freely from natural aspect ratio.
    """
    if not processed_items:
        return "", 0

    max_grid_width = 552
    gap = 8
    node_content = []
    total_media_height = 0
    n = len(processed_items)

    if n == 1:
        item = processed_items[0]
        calc_height = max(100, int(round(max_grid_width / item["aspect"])))
        total_media_height = calc_height

        play_overlay = ""
        if item.get("is_video"):
            play_r = min(max_grid_width, calc_height) * 0.15
            cx = max_grid_width / 2
            cy = calc_height / 2
            p_size = play_r * 0.7
            p1 = f"{cx - p_size*0.4},{cy - p_size*0.6}"
            p2 = f"{cx + p_size*0.6},{cy}"
            p3 = f"{cx - p_size*0.4},{cy + p_size*0.6}"
            play_overlay = f'''
    <circle cx="{cx}" cy="{cy}" r="{play_r}" fill="rgba(0,0,0,0.55)" clip-path="url(#free-clip-1_{tid_str})"/>
    <polygon points="{p1} {p2} {p3}" fill="#FFFFFF" clip-path="url(#free-clip-1_{tid_str})"/>'''

        node_content.append(f'''
  <!-- 1 IMAGE (Uncropped Freed Dimensions: {max_grid_width}px x {calc_height}px) -->
  <g id="media-card-1_{tid_str}" transform="translate(24, {media_y})">
    <clipPath id="free-clip-1_{tid_str}">
      <rect x="0" y="0" width="{max_grid_width}" height="{calc_height}" rx="16" ry="16" />
    </clipPath>
    <rect x="0" y="0" width="{max_grid_width}" height="{calc_height}" rx="16" ry="16" fill="#000000" stroke="#2F3336" stroke-width="1.5"/>
    <image href="{escape_xml(item['b64'])}" x="0" y="0" width="{max_grid_width}" height="{calc_height}" clip-path="url(#free-clip-1_{tid_str})" preserveAspectRatio="xMidYMin slice"/>{play_overlay}
  </g>''')

    elif n == 2:
        col_width = (max_grid_width - gap) // 2
        h1 = max(100, int(round(col_width / processed_items[0]["aspect"])))
        h2 = max(100, int(round(col_width / processed_items[1]["aspect"])))
        total_media_height = max(h1, h2)

        node_content.append(f'''
  <!-- 2 IMAGES (Freed Natural Heights: Left={h1}px, Right={h2}px) -->
  <g id="media-card-freed-2_{tid_str}" transform="translate(24, {media_y})">
    <clipPath id="free-clip-2-left_{tid_str}"><rect x="0" y="0" width="{col_width}" height="{h1}" rx="16" ry="16" /></clipPath>
    <clipPath id="free-clip-2-right_{tid_str}"><rect x="{col_width + gap}" y="0" width="{col_width}" height="{h2}" rx="16" ry="16" /></clipPath>
    <rect x="0" y="0" width="{col_width}" height="{h1}" rx="16" fill="#000000" stroke="#2F3336" stroke-width="1.5"/>
    <image href="{escape_xml(processed_items[0]['b64'])}" x="0" y="0" width="{col_width}" height="{h1}" clip-path="url(#free-clip-2-left_{tid_str})" preserveAspectRatio="xMidYMin slice"/>
    <rect x="{col_width + gap}" y="0" width="{col_width}" height="{h2}" rx="16" fill="#000000" stroke="#2F3336" stroke-width="1.5"/>
    <image href="{escape_xml(processed_items[1]['b64'])}" x="{col_width + gap}" y="0" width="{col_width}" height="{h2}" clip-path="url(#free-clip-2-right_{tid_str})" preserveAspectRatio="xMidYMin slice"/>
  </g>''')

    elif n == 3:
        col_width = (max_grid_width - gap) // 2
        h1 = max(100, int(round(col_width / processed_items[0]["aspect"])))
        h2 = max(100, int(round(col_width / processed_items[1]["aspect"])))
        top_row_height = max(h1, h2)

        h3 = max(100, int(round(col_width / processed_items[2]["aspect"])))
        bottom_y = top_row_height + gap
        total_media_height = top_row_height + gap + h3
        bottom_x = (max_grid_width - col_width) // 2

        node_content.append(f'''
  <!-- 3 IMAGES (Freed Natural Heights) -->
  <g id="media-card-freed-3_{tid_str}" transform="translate(24, {media_y})">
    <clipPath id="free-clip-3-tl_{tid_str}"><rect x="0" y="0" width="{col_width}" height="{h1}" rx="16" ry="16" /></clipPath>
    <clipPath id="free-clip-3-tr_{tid_str}"><rect x="{col_width + gap}" y="0" width="{col_width}" height="{h2}" rx="16" ry="16" /></clipPath>
    <clipPath id="free-clip-3-bottom_{tid_str}"><rect x="{bottom_x}" y="{bottom_y}" width="{col_width}" height="{h3}" rx="16" ry="16" /></clipPath>

    <rect x="0" y="0" width="{col_width}" height="{h1}" rx="16" fill="#000000" stroke="#2F3336" stroke-width="1.5"/>
    <image href="{escape_xml(processed_items[0]['b64'])}" x="0" y="0" width="{col_width}" height="{h1}" clip-path="url(#free-clip-3-tl_{tid_str})" preserveAspectRatio="xMidYMin slice"/>

    <rect x="{col_width + gap}" y="0" width="{col_width}" height="{h2}" rx="16" fill="#000000" stroke="#2F3336" stroke-width="1.5"/>
    <image href="{escape_xml(processed_items[1]['b64'])}" x="{col_width + gap}" y="0" width="{col_width}" height="{h2}" clip-path="url(#free-clip-3-tr_{tid_str})" preserveAspectRatio="xMidYMin slice"/>

    <rect x="{bottom_x}" y="{bottom_y}" width="{col_width}" height="{h3}" rx="16" fill="#000000" stroke="#2F3336" stroke-width="1.5"/>
    <image href="{escape_xml(processed_items[2]['b64'])}" x="{bottom_x}" y="{bottom_y}" width="{col_width}" height="{h3}" clip-path="url(#free-clip-3-bottom_{tid_str})" preserveAspectRatio="xMidYMin slice"/>
  </g>''')

    else:
        col_width = (max_grid_width - gap) // 2
        h1 = max(100, int(round(col_width / processed_items[0]["aspect"])))
        h2 = max(100, int(round(col_width / processed_items[1]["aspect"])))
        row1_height = max(h1, h2)

        h3 = max(100, int(round(col_width / processed_items[2]["aspect"])))
        h4 = max(100, int(round(col_width / processed_items[3]["aspect"])))
        row2_height = max(h3, h4)

        row2_y = row1_height + gap
        total_media_height = row1_height + gap + row2_height

        node_content.append(f'''
  <!-- 4 IMAGES (Freed Natural Heights) -->
  <g id="media-card-freed-4_{tid_str}" transform="translate(24, {media_y})">
    <clipPath id="free-clip-4-tl_{tid_str}"><rect x="0" y="0" width="{col_width}" height="{h1}" rx="14" ry="14" /></clipPath>
    <clipPath id="free-clip-4-tr_{tid_str}"><rect x="{col_width + gap}" y="0" width="{col_width}" height="{h2}" rx="14" ry="14" /></clipPath>
    <clipPath id="free-clip-4-bl_{tid_str}"><rect x="0" y="{row2_y}" width="{col_width}" height="{h3}" rx="14" ry="14" /></clipPath>
    <clipPath id="free-clip-4-br_{tid_str}"><rect x="{col_width + gap}" y="{row2_y}" width="{col_width}" height="{h4}" rx="14" ry="14" /></clipPath>

    <rect x="0" y="0" width="{col_width}" height="{h1}" rx="14" fill="#000000" stroke="#2F3336" stroke-width="1"/>
    <image href="{escape_xml(processed_items[0]['b64'])}" x="0" y="0" width="{col_width}" height="{h1}" clip-path="url(#free-clip-4-tl_{tid_str})" preserveAspectRatio="xMidYMin slice"/>

    <rect x="{col_width + gap}" y="0" width="{col_width}" height="{h2}" rx="14" fill="#000000" stroke="#2F3336" stroke-width="1"/>
    <image href="{escape_xml(processed_items[1]['b64'])}" x="{col_width + gap}" y="0" width="{col_width}" height="{h2}" clip-path="url(#free-clip-4-tr_{tid_str})" preserveAspectRatio="xMidYMin slice"/>

    <rect x="0" y="{row2_y}" width="{col_width}" height="{h3}" rx="14" fill="#000000" stroke="#2F3336" stroke-width="1"/>
    <image href="{escape_xml(processed_items[2]['b64'])}" x="0" y="{row2_y}" width="{col_width}" height="{h3}" clip-path="url(#free-clip-4-bl_{tid_str})" preserveAspectRatio="xMidYMin slice"/>

    <rect x="{col_width + gap}" y="{row2_y}" width="{col_width}" height="{h4}" rx="14" fill="#000000" stroke="#2F3336" stroke-width="1"/>
    <image href="{escape_xml(processed_items[3]['b64'])}" x="{col_width + gap}" y="{row2_y}" width="{col_width}" height="{h4}" clip-path="url(#free-clip-4-br_{tid_str})" preserveAspectRatio="xMidYMin slice"/>
  </g>''')

    return "".join(node_content), total_media_height

def calculate_layout(text_lines, estimated_media_height=0):
    """Calculates dynamic Y positions and total card height."""
    line_height = 22
    num_lines = len(text_lines)
    text_height = num_lines * line_height if num_lines > 0 else 0

    first_text_y = 104
    current_y = first_text_y + text_height if text_height > 0 else 84

    media_y = 0
    if estimated_media_height > 0:
        media_y = current_y + 12
        current_y = media_y + estimated_media_height

    meta_y = current_y + 24
    divider_y = meta_y + 18
    actions_y = divider_y + 14
    card_height = actions_y + 30

    return {
        "first_text_y": first_text_y,
        "text_height": text_height,
        "media_y": media_y,
        "meta_y": meta_y,
        "divider_y": divider_y,
        "actions_y": actions_y,
        "card_height": card_height
    }

class TimingTracker:
    """Thread-safe performance instrumentation tracker."""
    def __init__(self):
        self._lock = Lock()
        self.metrics = {
            "media_indexing": 0.0,
            "media_lookup": 0.0,
            "image_preprocessing": 0.0,
            "video_poster_extraction": 0.0,
            "svg_generation": 0.0,
            "resvg_rendering": 0.0,
            "webp_encoding": 0.0
        }

    def add(self, key, val):
        with self._lock:
            if key in self.metrics:
                self.metrics[key] += val

    def get_dict(self):
        with self._lock:
            return dict(self.metrics)

class ManifestManager:
    """Thread-safe manager for media-aware snapshot resumability (.snapshot_manifest.json)."""
    def __init__(self, out_dir):
        self.out_dir = out_dir
        self.manifest_file = os.path.join(out_dir, ".snapshot_manifest.json")
        self._lock = Lock()
        self.data = {}
        self.load()

    def load(self):
        with self._lock:
            if os.path.exists(self.manifest_file):
                try:
                    with open(self.manifest_file, "r", encoding="utf-8") as f:
                        self.data = json.load(f)
                except Exception as e:
                    logger.warning(f"Failed to load snapshot manifest {self.manifest_file}: {e}")
                    self.data = {}
            else:
                self.data = {}

    def save(self):
        with self._lock:
            if not os.path.exists(self.out_dir):
                os.makedirs(self.out_dir, exist_ok=True)
            try:
                with open(self.manifest_file, "w", encoding="utf-8") as f:
                    json.dump(self.data, f, indent=2)
            except Exception as e:
                logger.warning(f"Failed to save snapshot manifest {self.manifest_file}: {e}")

    def get_embedded_media_count(self, tid_str):
        with self._lock:
            entry = self.data.get(str(tid_str))
            if isinstance(entry, dict):
                return entry.get("embedded_media_count", -1)
            elif isinstance(entry, int):
                return entry
            return -1

    def update_entry(self, tid_str, embedded_media_count):
        with self._lock:
            self.data[str(tid_str)] = {
                "embedded_media_count": embedded_media_count,
                "updated_at": datetime.now().isoformat()
            }

class TweetArchiveProcessor:
    def __init__(self, media_dir, json_file, out_dir=None, dry_run=False, workers=4, 
                 webp_quality=95, webp_method=4, filter_tids=None):
        self.media_dir = os.path.abspath(media_dir)
        self.json_file = os.path.abspath(json_file)
        self.out_dir = os.path.abspath(out_dir) if out_dir else None
        self.dry_run = dry_run
        self.workers = workers
        self.webp_quality = webp_quality
        self.webp_method = webp_method
        self.filter_tids = set(str(t) for t in filter_tids) if filter_tids else None
        
        self.account_dirname = os.path.basename(self.media_dir)
        self.account_handle = self.account_dirname
        if self.account_handle.endswith("_tweets"):
            self.account_handle = self.account_handle[:-7]

        # WebP snapshots generated directly in the media directory containing original files
        self.account_out_dir = self.resolve_output_dir()
        self.manifest = ManifestManager(self.account_out_dir)
            
        self.tweets = {} # tid_str -> dict
        self.media_index = {}
        self.fallback_index = {}
        self.index_collisions = 0
        self.non_canonical_files = 0
        
        self.timing = TimingTracker()
        
        # Comprehensive & Internally Consistent Result Tracking
        self.stats = {
            "tweets_total": 0,
            "snapshots_created": 0,
            "snapshots_skipped": 0,
            "skipped_no_media": 0,
            "skipped_no_text": 0,
            "skipped_no_text_or_media": 0,
            "skipped_existing": 0,
            "success_full_media": 0,
            "success_partial_media": 0,
            "regenerated_with_new_media": 0,
            "missing_media_count": 0,
            "tweet_errors": 0,
            "media_total": 0,
            "media_found": 0
        }

    def load_data(self):
        """Parse raw JSON metadata and build O(1) media index once."""
        if not os.path.exists(self.json_file):
            raise FileNotFoundError(f"JSON file not found: {self.json_file}")

        # 1. Build Media Index ONCE (Strict Canonical Parsing)
        m_idx, fb_idx, collisions, non_canon, idx_time = build_media_index(self.media_dir)
        self.media_index = m_idx
        self.fallback_index = fb_idx
        self.index_collisions = collisions
        self.non_canonical_files = non_canon
        self.timing.add("media_indexing", idx_time)

        # 2. Parse Raw JSON Metadata
        with open(self.json_file, "r", encoding="utf-8", errors="replace") as f:
            raw_data = json.load(f)

        author_handle_found = None
        for item in raw_data:
            if not isinstance(item, list) or len(item) < 2:
                continue
            code = item[0]
            if code <= 0:
                continue
            
            meta = item[1] if code == 2 else (item[2] if code == 3 and len(item) >= 3 else None)
            if not isinstance(meta, dict):
                continue
            
            tid = meta.get("tweet_id")
            if not tid:
                continue
            
            tid_str = str(tid)
            if self.filter_tids and tid_str not in self.filter_tids:
                continue

            if tid_str not in self.tweets:
                self.tweets[tid_str] = {
                    "tweet_id": tid_str,
                    "date_str": meta.get("date"),
                    "content": meta.get("content", ""),
                    "author_name": meta.get("author", {}).get("name") or meta.get("user", {}).get("name"),
                    "author_nick": meta.get("author", {}).get("nick") or meta.get("user", {}).get("nick"),
                    "favorite_count": meta.get("favorite_count", 0),
                    "retweet_count": meta.get("retweet_count", 0),
                    "bookmark_count": meta.get("bookmark_count", 0),
                    "reply_count": meta.get("reply_count", 0),
                    "view_count": meta.get("view_count", 0),
                    "media": []
                }
            
            if not author_handle_found:
                author_handle_found = meta.get("author", {}).get("name") or meta.get("user", {}).get("name")
            
            if code == 3:
                orig_id = meta.get("filename") # Twitter media ID
                ext = meta.get("extension", "jpg")
                mtype = meta.get("type", "photo")
                num = meta.get("num", 1)
                
                existing = [m for m in self.tweets[tid_str]["media"] if m.get("filename") == orig_id]
                if not existing:
                    self.tweets[tid_str]["media"].append({
                        "filename": orig_id,
                        "extension": ext,
                        "type": mtype,
                        "num": num
                    })

        if author_handle_found:
            self.account_handle = author_handle_found

        # Re-resolve account output directory and manifest to ensure alignment with final handle
        self.account_out_dir = self.resolve_output_dir()
        self.manifest = ManifestManager(self.account_out_dir)

        # 3. O(1) Lookup Media File Assignment
        t0 = time.perf_counter()
        total_media_count = 0
        found_media_count = 0

        for tid_str, tdata in self.tweets.items():
            for mitem in tdata["media"]:
                total_media_count += 1
                orig_id = mitem.get("filename")
                if not orig_id:
                    mitem["local_path"] = None
                    continue

                # Primary O(1) lookup by (tweet_id, media_id)
                local_path = self.media_index.get((tid_str, orig_id))
                # Fallback lookup by media_id
                if not local_path:
                    local_path = self.fallback_index.get(orig_id)

                if local_path and os.path.exists(local_path):
                    mitem["local_path"] = local_path
                    found_media_count += 1
                else:
                    mitem["local_path"] = None

        self.timing.add("media_lookup", time.perf_counter() - t0)

        self.stats["tweets_total"] = len(self.tweets)
        self.stats["media_total"] = total_media_count
        self.stats["media_found"] = found_media_count

    def resolve_output_dir(self):
        """Webp snapshots generated directly in the same folder as the original media files."""
        if self.out_dir:
            return self.out_dir
        return self.media_dir

    def render_perfect_tweet_svg(self, tweet_data, processed_media_items, display_date):
        """Builds native SVG Tweet Card."""
        tid = tweet_data["tweet_id"]
        display_name = escape_xml(tweet_data["author_nick"] or self.account_handle)
        handle = escape_xml(f"@{self.account_handle}")
        
        replies = format_number(tweet_data.get("reply_count", 0))
        reposts = format_number(tweet_data.get("retweet_count", 0))
        likes = format_number(tweet_data.get("favorite_count", 0))
        views = format_number(tweet_data.get("view_count", 0))

        text_lines = wrap_text_to_svg_lines(tweet_data.get("content", ""), max_chars=50)

        _, media_height = render_freed_dimensions_media_section(processed_media_items, 0, tid)
        layout = calculate_layout(text_lines, media_height)
        media_node, _ = render_freed_dimensions_media_section(processed_media_items, layout["media_y"], tid)

        text_node = ""
        if text_lines:
            tspans = []
            for i, line in enumerate(text_lines):
                y_pos = layout["first_text_y"] + (i * 22)
                tspans.append(f'<tspan x="24" y="{y_pos}">{escape_xml(line)}</tspan>')
            
            tspans_content = "\n    ".join(tspans)
            text_node = f'''
  <!-- TWEET BODY TEXT (Native SVG <text> with explicit <tspan> lines) -->
  <text class="tweet-body-text" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="15" fill="#E7E9EA">
    {tspans_content}
  </text>'''

        initial = display_name[0].upper() if display_name else "X"
        avatar_svg_node = f'''
  <circle cx="48" cy="48" r="24" fill="#1D9BF0" />
  <text x="48" y="48" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="22" font-weight="bold" text-anchor="middle" dominant-baseline="central">{escape_xml(initial)}</text>
  <circle cx="48" cy="48" r="23.5" fill="none" stroke="#2F3336" stroke-width="1" />'''

        retina_w = 1200
        retina_h = layout['card_height'] * 2

        svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 {layout['card_height']}" width="{retina_w}" height="{retina_h}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">
  <defs>
    <filter id="card-shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#000000" flood-opacity="0.6"/>
    </filter>

    <clipPath id="avatar-clip">
      <circle cx="48" cy="48" r="24" />
    </clipPath>

    <linearGradient id="verified-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1D9BF0"/>
      <stop offset="100%" stop-color="#0077E6"/>
    </linearGradient>
  </defs>

  <style>
    .card-bg {{ fill: #000000; stroke: #2F3336; stroke-width: 1.5; }}
    .author-name {{ font-size: 16px; font-weight: 700; fill: #FFFFFF; }}
    .author-handle {{ font-size: 14px; font-weight: 400; fill: #71767B; }}
    .tweet-body-text {{ font-size: 15px; font-weight: 400; fill: #E7E9EA; line-height: 22px; }}
    .meta-text {{ font-size: 14px; font-weight: 400; fill: #71767B; }}
    .stat-count {{ font-size: 13px; font-weight: 600; fill: #71767B; }}
    .action-icon {{ fill: #71767B; }}
  </style>

  <!-- PURE SOLID BLACK (#000000) Outer Card Container -->
  <rect x="2" y="2" width="596" height="{layout['card_height'] - 4}" rx="16" ry="16" fill="#000000" stroke="#2F3336" stroke-width="1.5" filter="url(#card-shadow)" />

  <!-- HEADER SECTION -->{avatar_svg_node}
  <text x="84" y="42" class="author-name">{display_name}</text>
  <text x="84" y="62" class="author-handle">{handle}</text>

  <!-- X Logo Top Right -->
  <g transform="translate(548, 28)">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="#71767B"/>
  </g>{text_node}{media_node}

  <!-- TIMESTAMP & METADATA -->
  <text x="24" y="{layout['meta_y']}" class="meta-text">{escape_xml(display_date)} · <tspan fill="#1D9BF0">{tid}</tspan></text>

  <!-- DIVIDER LINE -->
  <line x1="24" y1="{layout['divider_y']}" x2="576" y2="{layout['divider_y']}" stroke="#2F3336" stroke-width="1"/>

  <!-- FOOTER ACTION BAR -->
  <g transform="translate(24, {layout['actions_y']})">
    <g transform="translate(0, 0)">
      <path class="action-icon" d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" transform="scale(0.8)"/>
      <text x="24" y="14" class="stat-count">{replies}</text>
    </g>

    <g transform="translate(130, 0)">
      <path class="action-icon" d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" transform="scale(0.8)"/>
      <text x="24" y="14" class="stat-count">{reposts}</text>
    </g>

    <g transform="translate(260, 0)">
      <path class="action-icon" d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z" transform="scale(0.8)"/>
      <text x="24" y="14" class="stat-count">{likes}</text>
    </g>

    <g transform="translate(390, 0)">
      <path class="action-icon" d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z" transform="scale(0.8)"/>
      <text x="24" y="14" class="stat-count">{views}</text>
    </g>

    <g transform="translate(520, 0)">
      <path class="action-icon" d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.29 3.3-1.42-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" transform="scale(0.8)"/>
    </g>
  </g>
</svg>'''
        return svg_content

    def process_tweet(self, tid_str, tdata, account_out_dir):
        """Process a single tweet: render WebP snapshot only if BOTH text and local media are available."""
        # 1. Text and Media Availability Evaluation
        tweet_content = (tdata.get("content") or "").strip()
        has_text = has_meaningful_text(tweet_content)

        referenced_media = tdata.get("media", [])
        available_media = [m for m in referenced_media if m.get("local_path")]
        has_media = bool(available_media and len(available_media) > 0)
        missing_count = len(referenced_media) - len(available_media)
        available_count = len(available_media)

        # STRICT RULE: Must have BOTH meaningful text and available local media
        # Eliminate: Meaningful text available but no media available
        # Eliminate: Media available but no meaningful text (e.g. empty or emoji/symbol-only)
        # Eliminate: Neither text nor media available
        if not has_text and not has_media:
            logger.debug(f"[{self.account_handle}] [SKIP_NO_TEXT_NO_MEDIA] Tweet {tid_str} has neither text nor local media; skipping.")
            return "SKIPPED_NO_TEXT_NO_MEDIA", "", 0, missing_count
        elif has_text and not has_media:
            logger.debug(f"[{self.account_handle}] [SKIP_NO_MEDIA] Tweet {tid_str} has text but no local media available; skipping.")
            return "SKIPPED_NO_MEDIA", "", 0, missing_count
        elif has_media and not has_text:
            reason = "emoji/symbol-only" if tweet_content else "no text"
            logger.debug(f"[{self.account_handle}] [SKIP_NO_TEXT] Tweet {tid_str} has local media ({available_count} items) but {reason}; skipping.")
            return "SKIPPED_NO_TEXT", "", 0, missing_count

        # 2. Timestamps & Snapshot Filename
        date_formatted, dt_obj, disp_date = parse_date_string(tdata.get("date_str"))
        if not date_formatted:
            first_media_path = None
            for m in available_media:
                if m.get("local_path"):
                    first_media_path = os.path.basename(m["local_path"])
                    break
            if first_media_path:
                date_formatted = extract_date_from_filename(first_media_path)
            else:
                date_formatted = "1970-01-01_00-00-00"

        safe_handle = sanitize_filename(self.account_handle)
        snapshot_filename = f"{date_formatted}_@{safe_handle}_{tid_str}.webp"
        snapshot_path = os.path.join(account_out_dir, snapshot_filename)

        # 3. Media-Aware Resumability Check (.snapshot_manifest.json)
        snapshot_exists = os.path.exists(snapshot_path) and os.path.getsize(snapshot_path) > 0
        was_regenerated = False

        if snapshot_exists:
            embedded_count = self.manifest.get_embedded_media_count(tid_str)
            # Legacy snapshot missing from manifest -> regenerate once if local media is available
            if embedded_count < 0 and available_count > 0:
                logger.info(f"[{self.account_handle}] [REGENERATE] Snapshot {snapshot_filename} exists without manifest record; regenerating once to establish manifest.")
                was_regenerated = True
            # Newly downloaded local media available -> regenerate to embed new media
            elif embedded_count >= 0 and available_count > embedded_count:
                logger.info(f"[{self.account_handle}] [REGENERATE] Tweet {tid_str} previously rendered with {embedded_count} media, but now {available_count} local media items exist; regenerating snapshot.")
                was_regenerated = True
            else:
                logger.debug(f"[{self.account_handle}] [SKIP] {snapshot_filename} already exists and is up to date (embedded media: {embedded_count})")
                return "SKIPPED_EXISTING", snapshot_filename, 0, missing_count

        if self.dry_run:
            status = "REGENERATED" if was_regenerated else "SUCCESS"
            return status, snapshot_filename, 1, missing_count

        # 4. Media Preprocessing
        processed_media_items = []
        for mitem in available_media[:4]:
            local_path = mitem.get("local_path")
            is_video = mitem.get("type") in ("video", "animated_gif") or mitem.get("extension") == "mp4"
            if local_path and os.path.exists(local_path):
                dims_data = get_image_dimensions_and_b64(local_path, is_video=is_video, timer_stats=self.timing)
                dims_data["is_video"] = is_video
                processed_media_items.append(dims_data)

        # 5. SVG Render -> resvg -> WebP Save
        try:
            t0_svg = time.perf_counter()
            svg_content = self.render_perfect_tweet_svg(tdata, processed_media_items, disp_date)
            self.timing.add("svg_generation", time.perf_counter() - t0_svg)

            t0_resvg = time.perf_counter()
            png_bytes = resvg_py.svg_to_bytes(svg_content)
            self.timing.add("resvg_rendering", time.perf_counter() - t0_resvg)

            t0_webp = time.perf_counter()
            with Image.open(io.BytesIO(png_bytes)) as img:
                img.save(snapshot_path, format="WEBP", quality=self.webp_quality, method=self.webp_method)
            self.timing.add("webp_encoding", time.perf_counter() - t0_webp)

            # Update manifest record
            self.manifest.update_entry(tid_str, available_count)

            # Classify status cleanly
            if missing_count > 0:
                status = "SUCCESS_PARTIAL_MEDIA"
                logger.info(f"[{self.account_handle}] [PARTIAL] Created snapshot {snapshot_filename} ({available_count}/{len(referenced_media)} media local)")
            else:
                status = "SUCCESS"
                logger.info(f"[{self.account_handle}] [OK] Created full media snapshot {snapshot_filename}")

            if was_regenerated:
                status += "_REGENERATED"

            return status, snapshot_filename, 1, missing_count

        except Exception as e:
            logger.error(f"[{self.account_handle}] [RENDER_ERROR] SVG/WebP rendering failed for tweet {tid_str}: {e}")
            return "RENDER_ERROR", snapshot_filename, 0, missing_count

    def run(self):
        """Execute processing pipeline for the account."""
        t_run_start = time.perf_counter()
        self.load_data()
        
        logger.info(f"\n==================================================")
        logger.info(f"Account Directory:     {self.account_dirname}")
        logger.info(f"Handle / Username:     @{self.account_handle}")
        logger.info(f"JSON Metadata File:    {self.json_file}")
        logger.info(f"Output Directory:      {self.account_out_dir}")
        logger.info(f"Total JSON Tweets:     {self.stats['tweets_total']}")
        logger.info(f"Total Referenced Media:{self.stats['media_total']}")
        logger.info(f"Available Local Media: {self.stats['media_found']}")
        logger.info(f"Index Key Collisions:  {self.index_collisions}")
        logger.info(f"Non-Canonical Files:   {self.non_canonical_files}")
        logger.info(f"WebP Encoding Setting: quality={self.webp_quality}, method={self.webp_method}")
        logger.info(f"==================================================\n")

        if not self.dry_run:
            os.makedirs(self.account_out_dir, exist_ok=True)

        completed_count = 0
        
        with ThreadPoolExecutor(max_workers=self.workers) as executor:
            future_to_tid = {
                executor.submit(self.process_tweet, tid_str, tdata, self.account_out_dir): tid_str
                for tid_str, tdata in self.tweets.items()
            }
            
            for future in as_completed(future_to_tid):
                tid_str = future_to_tid[future]
                completed_count += 1
                try:
                    status, snap_file, created_count, missing_count = future.result()
                    
                    if "SUCCESS" in status or "REGENERATED" in status:
                        self.stats["snapshots_created"] += created_count

                    if status.startswith("SUCCESS_PARTIAL_MEDIA"):
                        self.stats["success_partial_media"] += 1
                    elif status.startswith("SUCCESS"):
                        self.stats["success_full_media"] += 1
                    elif status == "SKIPPED_NO_MEDIA":
                        self.stats["snapshots_skipped"] += 1
                        self.stats["skipped_no_media"] += 1
                    elif status == "SKIPPED_NO_TEXT":
                        self.stats["snapshots_skipped"] += 1
                        self.stats["skipped_no_text"] += 1
                    elif status == "SKIPPED_NO_TEXT_NO_MEDIA":
                        self.stats["snapshots_skipped"] += 1
                        self.stats["skipped_no_text_or_media"] += 1
                    elif status == "SKIPPED_EXISTING" or status == "SKIPPED":
                        self.stats["snapshots_skipped"] += 1
                        self.stats["skipped_existing"] += 1
                    elif status == "RENDER_ERROR":
                        self.stats["tweet_errors"] += 1

                    if "REGENERATED" in status:
                        self.stats["regenerated_with_new_media"] += 1
                    
                    self.stats["missing_media_count"] += missing_count

                except Exception as e:
                    logger.error(f"[{self.account_handle}] Exception processing tweet {tid_str}: {e}")
                    self.stats["tweet_errors"] += 1

                if completed_count % 50 == 0 or completed_count == self.stats["tweets_total"]:
                    logger.info(f"[{self.account_handle}] Progress: {completed_count} / {self.stats['tweets_total']} tweets evaluated")

        # Save manifest at completion of account run
        if not self.dry_run:
            self.manifest.save()

        elapsed_run = time.perf_counter() - t_run_start
        t_metrics = self.timing.get_dict()

        logger.info(f"\n--------------------------------------------------")
        logger.info(f"ACCOUNT PROCESSING SUMMARY: @{self.account_handle}")
        logger.info(f"Total Tweets Evaluated:         {self.stats['tweets_total']}")
        logger.info(f"Snapshots Created (Total):      {self.stats['snapshots_created']}")
        logger.info(f"  - Full Media Snapshots:       {self.stats['success_full_media']}")
        logger.info(f"  - Partial Media Snapshots:    {self.stats['success_partial_media']}")
        logger.info(f"  - Regenerated With New Media: {self.stats['regenerated_with_new_media']}")
        logger.info(f"Snapshots Skipped (Total):      {self.stats['snapshots_skipped']}")
        logger.info(f"  - Skipped (No Local Media):   {self.stats['skipped_no_media']}")
        logger.info(f"  - Skipped (No Tweet Text):    {self.stats['skipped_no_text']}")
        logger.info(f"  - Skipped (No Text & Media):  {self.stats['skipped_no_text_or_media']}")
        logger.info(f"  - Skipped (Already Exists):   {self.stats['skipped_existing']}")
        logger.info(f"Rendering Errors:               {self.stats['tweet_errors']}")
        logger.info(f"Missing Local Media Items:      {self.stats['missing_media_count']}")
        logger.info(f"Media Index Collisions:         {self.index_collisions}")
        logger.info(f"Non-Canonical Media Files:      {self.non_canonical_files}")
        logger.info(f"--------------------------------------------------")
        logger.info(f"PERFORMANCE TIMING INSTRUMENTATION:")
        logger.info(f"  Total Run Time:               {elapsed_run:.2f}s")
        logger.info(f"  Media Indexing Time:          {t_metrics['media_indexing']:.4f}s")
        logger.info(f"  Media Lookup Time:            {t_metrics['media_lookup']:.4f}s")
        logger.info(f"  Image Preprocessing Time:     {t_metrics['image_preprocessing']:.4f}s")
        logger.info(f"  Video Poster Extraction Time: {t_metrics['video_poster_extraction']:.4f}s")
        logger.info(f"  SVG Generation Time:          {t_metrics['svg_generation']:.4f}s")
        logger.info(f"  resvg Rendering Time:         {t_metrics['resvg_rendering']:.4f}s")
        logger.info(f"  WebP Encoding Time:           {t_metrics['webp_encoding']:.4f}s")
        logger.info(f"Output Directory:               {self.account_out_dir}")
        logger.info(f"--------------------------------------------------\n")
        
        self.stats["run_time"] = elapsed_run
        self.stats["timing"] = t_metrics
        return self.stats

def discover_accounts(media_root, raw_root):
    """Discover valid account subdirectories under media_root, excluding Tweets and excluded directories."""
    if not os.path.exists(media_root):
        raise FileNotFoundError(f"Media root directory not found: {media_root}")
    
    entries = os.listdir(media_root)
    valid_accounts = []
    missing_json_accounts = []
    
    for entry in sorted(entries):
        if entry in EXCLUDED_DIRS or entry.lower() == "tweets":
            logger.info(f"[EXCLUDE] Explicitly skipping excluded directory: Media/{entry}")
            continue
        
        media_path = os.path.join(media_root, entry)
        if os.path.isdir(media_path):
            json_name = f"{entry}.json"
            json_path = os.path.join(raw_root, json_name)
            if os.path.exists(json_path):
                valid_accounts.append((entry, media_path, json_path))
            else:
                missing_json_accounts.append((entry, media_path, json_path))

    return valid_accounts, missing_json_accounts

def main():
    parser = argparse.ArgumentParser(description="Bulk Tweet Visual Archive Generator (Browser-Free WebP Renderer)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--account", type=str, help="Single account directory name or path (e.g. keerthi_and_etc_tweets)")
    group.add_argument("--root", type=str, help="Root Media directory containing account subdirectories")
    
    parser.add_argument("--raw-dir", type=str, default=DEFAULT_RAW_DIR, help="Path to RawData JSON directory")
    parser.add_argument("--media-dir", type=str, default=DEFAULT_MEDIA_DIR, help="Path to Media directory")
    parser.add_argument("--output-dir", "--out-dir", dest="output_dir", type=str, default=None, help="Optional custom output directory (default: same folder as original media files)")
    parser.add_argument("--dry-run", action="store_true", help="Validation mode: inspect data without writing snapshots")
    parser.add_argument("--workers", type=int, default=4, help="Number of concurrent worker threads (default: 4)")
    parser.add_argument("--webp-quality", type=int, default=95, help="WebP quality parameter (1-100, default: 95)")
    parser.add_argument("--webp-method", type=int, default=4, help="WebP compression method (0-6, default: 4)")
    parser.add_argument("--log-file", type=str, default="archive_generator.log", help="Path to output log file")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose debug logging")
    parser.add_argument("--tweet-ids", type=str, help="Comma-separated tweet IDs to process specifically for testing")

    args = parser.parse_args()
    setup_logging(args.log_file, args.verbose)

    filter_tids = [t.strip() for t in args.tweet_ids.split(",")] if args.tweet_ids else None

    if args.dry_run:
        logger.info("=== RUNNING IN DRY-RUN / VALIDATION MODE ===")

    if args.account:
        account_name = os.path.basename(args.account.rstrip(r"\/"))
        if account_name in EXCLUDED_DIRS or account_name.lower() == "tweets":
            logger.info(f"[EXCLUDE] Skipping excluded account/directory: {account_name}")
            return

        media_path = os.path.join(args.media_dir, account_name) if not os.path.isabs(args.account) else args.account
        json_path = os.path.join(args.raw_dir, f"{account_name}.json")
        
        if not os.path.exists(media_path):
            logger.error(f"Single account media path not found: {media_path}")
            sys.exit(1)
        if not os.path.exists(json_path):
            logger.error(f"Single account JSON path not found: {json_path}")
            sys.exit(1)
            
        processor = TweetArchiveProcessor(
            media_dir=media_path,
            json_file=json_path,
            out_dir=args.output_dir,
            dry_run=args.dry_run,
            workers=args.workers,
            webp_quality=args.webp_quality,
            webp_method=args.webp_method,
            filter_tids=filter_tids
        )
        processor.run()

    elif args.root:
        media_root = args.root
        valid_accounts, missing_json = discover_accounts(media_root, args.raw_dir)
        
        logger.info(f"Discovered {len(valid_accounts)} valid account directories in {media_root}")
        if missing_json:
            logger.warning(f"Found {len(missing_json)} account directories without corresponding RawData JSON files:")
            for acc, m_path, j_path in missing_json:
                logger.warning(f"  - Directory: {acc} | Missing: {j_path}")

        total_stats = {
            "accounts_processed": 0,
            "tweets_total": 0,
            "snapshots_created": 0,
            "snapshots_skipped": 0,
            "skipped_no_media": 0,
            "skipped_no_text": 0,
            "skipped_no_text_or_media": 0,
            "skipped_existing": 0,
            "tweet_errors": 0,
            "missing_media_count": 0,
            "regenerated_with_new_media": 0
        }

        for acc_name, media_path, json_path in valid_accounts:
            try:
                processor = TweetArchiveProcessor(
                    media_dir=media_path,
                    json_file=json_path,
                    out_dir=args.output_dir,
                    dry_run=args.dry_run,
                    workers=args.workers,
                    webp_quality=args.webp_quality,
                    webp_method=args.webp_method,
                    filter_tids=filter_tids
                )
                stats = processor.run()
                total_stats["accounts_processed"] += 1
                total_stats["tweets_total"] += stats["tweets_total"]
                total_stats["snapshots_created"] += stats["snapshots_created"]
                total_stats["snapshots_skipped"] += stats["snapshots_skipped"]
                total_stats["skipped_no_media"] += stats.get("skipped_no_media", 0)
                total_stats["skipped_no_text"] += stats.get("skipped_no_text", 0)
                total_stats["skipped_no_text_or_media"] += stats.get("skipped_no_text_or_media", 0)
                total_stats["skipped_existing"] += stats.get("skipped_existing", 0)
                total_stats["tweet_errors"] += stats["tweet_errors"]
                total_stats["missing_media_count"] += stats["missing_media_count"]
                total_stats["regenerated_with_new_media"] += stats["regenerated_with_new_media"]
            except Exception as e:
                logger.error(f"Failed to process account {acc_name}: {e}")

        logger.info(f"\n==================================================")
        logger.info(f"FINAL ROOT BATCH SUMMARY")
        logger.info(f"Accounts Processed:         {total_stats['accounts_processed']}")
        logger.info(f"Total Tweets Evaluated:     {total_stats['tweets_total']}")
        logger.info(f"Snapshots Created:          {total_stats['snapshots_created']}")
        logger.info(f"Regenerated With New Media: {total_stats['regenerated_with_new_media']}")
        logger.info(f"Snapshots Skipped:          {total_stats['snapshots_skipped']}")
        logger.info(f"  - No Local Media:         {total_stats['skipped_no_media']}")
        logger.info(f"  - No Tweet Text:          {total_stats['skipped_no_text']}")
        logger.info(f"  - No Text & Media:        {total_stats['skipped_no_text_or_media']}")
        logger.info(f"  - Already Exists:         {total_stats['skipped_existing']}")
        logger.info(f"Total Errors:               {total_stats['tweet_errors']}")
        logger.info(f"Missing Local Media Items:  {total_stats['missing_media_count']}")
        logger.info(f"==================================================\n")

if __name__ == "__main__":
    main()
