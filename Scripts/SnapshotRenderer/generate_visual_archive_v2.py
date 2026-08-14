#!/usr/bin/env python3
"""
Bulk Tweet Visual Archive Generator v2 (Browser-Free WebP Renderer - HTML Input)
==================================================================================
Reads tweet metadata directly from offline HTML timeline files (`<account>_tweets.html` or `None_tweets.html`)
and renders pixel-perfect X/Twitter Dark Mode WebP visual snapshots using the exact Version 1 SVG engine.

Pipeline:
  HTML Timeline File -> Parse metadata & text -> O(1) Local Media Index -> 
  Exact V1 Dark-Theme Native SVG -> resvg-py (png bytes) -> Pillow (WebP)
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
import math
import random
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
    from bs4 import BeautifulSoup
except ImportError as e:
    print(f"CRITICAL ERROR: Required package missing ({e}). Run: pip install beautifulsoup4")
    sys.exit(1)

try:
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

# Default Paths & Constants
DEFAULT_BASE_DIR = r"C:\Users\hello\Pictures\Gallery-Dl\TweetData"
DEFAULT_MEDIA_DIR = os.path.join(DEFAULT_BASE_DIR, "Media")
DEFAULT_OUT_DIR = os.path.join(DEFAULT_BASE_DIR, "Completed")
EXCLUDED_DIRS = {"Tweets", "Completed N", "FACEBOOK", "Mega_Account_01"}

# Strict Canonical Filename Regex
CANONICAL_MEDIA_REGEX = re.compile(
    r"^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})_@(.+)_(\d{15,22})_([A-Za-z0-9_-]+)\.([A-Za-z0-9]+)$"
)

# Setup Logger
logger = logging.getLogger("VisualArchiveV2")

def setup_logging(log_file=None, verbose=False):
    level = logging.DEBUG if verbose else logging.INFO
    formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", datefmt="%H:%M:%S")

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(console_handler)

    if log_file:
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)

def escape_xml(text):
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

def sanitize_filename(name):
    if not name:
        return "unnamed"
    return re.sub(r'[\\/*?:"<>|]', "_", str(name)).strip()

def format_number(num):
    try:
        n = int(num)
        if n >= 1_000_000:
            return f"{n / 1_000_000:.1f}M"
        if n >= 1_000:
            return f"{n / 1_000:.1f}K"
        return str(n)
    except Exception:
        return "0"

def wrap_text_to_svg_lines(text, max_chars=50):
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
    t0 = time.perf_counter()
    media_index = {}
    fallback_index = {}
    tid_to_paths = {}
    collisions = 0
    non_canonical_count = 0

    if not os.path.exists(media_dir):
        return media_index, fallback_index, tid_to_paths, 0, 0, time.perf_counter() - t0

    for root, dirs, files in os.walk(media_dir):
        for fname in files:
            fpath = os.path.join(root, fname)
            match = CANONICAL_MEDIA_REGEX.match(fname)
            if match:
                dt_str, account, tid_str, media_id, ext = match.groups()
                key = (tid_str, media_id)
                if key in media_index:
                    collisions += 1
                else:
                    media_index[key] = fpath

                if media_id not in fallback_index:
                    fallback_index[media_id] = fpath

                if tid_str not in tid_to_paths:
                    tid_to_paths[tid_str] = []
                if fpath not in tid_to_paths[tid_str]:
                    tid_to_paths[tid_str].append(fpath)
            else:
                if not fname.startswith(".") and not fname.endswith(".json") and not fname.endswith(".html") and not fname.endswith(".webp"):
                    non_canonical_count += 1

    elapsed = time.perf_counter() - t0
    return media_index, fallback_index, tid_to_paths, collisions, non_canonical_count, elapsed

def get_image_dimensions_and_b64(file_path, is_video=False, max_dim=1800, timer_stats=None):
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
                            return {"width": w, "height": h, "aspect": float(w) / float(h) if h else 1.0, "b64": b64, "is_video": True}

            if timer_stats is not None:
                timer_stats.add("video_poster_extraction", time.perf_counter() - t0)
            return default_dims

        t0 = time.perf_counter()
        with Image.open(file_path) as img:
            w, h = img.size
            fmt = (img.format or "JPEG").upper()

        aspect = float(w) / float(h) if h else 1.0

        if max(w, h) <= max_dim and fmt in ("JPEG", "JPG", "PNG", "WEBP"):
            mime_type = "jpeg" if fmt in ("JPEG", "JPG") else fmt.lower()
            with open(file_path, "rb") as f:
                raw_bytes = f.read()
            b64 = f"data:image/{mime_type};base64," + base64.b64encode(raw_bytes).decode("ascii")
            if timer_stats is not None:
                timer_stats.add("image_preprocessing", time.perf_counter() - t0)
            return {"width": w, "height": h, "aspect": aspect, "b64": b64, "is_video": False}

        with Image.open(file_path) as img:
            img_conv = img.convert("RGB")
            img_conv.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            img_conv.save(buf, format="JPEG", quality=95)
            b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

        if timer_stats is not None:
            timer_stats.add("image_preprocessing", time.perf_counter() - t0)
        return {"width": w, "height": h, "aspect": aspect, "b64": b64, "is_video": False}

    except Exception as e:
        logger.debug(f"Failed to process media file {file_path}: {e}")
        return default_dims

def render_freed_dimensions_media_section(processed_items, media_y, tid_str):
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
    def __init__(self):
        self._lock = Lock()
        self.metrics = {
            "media_indexing": 0.0,
            "media_lookup": 0.0,
            "html_parsing": 0.0,
            "image_preprocessing": 0.0,
            "video_poster_extraction": 0.0,
            "svg_generation": 0.0,
            "resvg_rendering": 0.0,
            "webp_encoding": 0.0,
            "total_run": 0.0
        }

    def add(self, key, val):
        with self._lock:
            if key in self.metrics:
                self.metrics[key] += val

    def report(self):
        with self._lock:
            return (
                f"PERFORMANCE TIMING INSTRUMENTATION:\n"
                f"  Total Run Time:               {self.metrics['total_run']:.2f}s\n"
                f"  Media Indexing Time:          {self.metrics['media_indexing']:.4f}s\n"
                f"  HTML Parsing Time:            {self.metrics['html_parsing']:.4f}s\n"
                f"  Image Preprocessing Time:     {self.metrics['image_preprocessing']:.4f}s\n"
                f"  Video Poster Extraction Time: {self.metrics['video_poster_extraction']:.4f}s\n"
                f"  SVG Generation Time:          {self.metrics['svg_generation']:.4f}s\n"
                f"  resvg Rendering Time:         {self.metrics['resvg_rendering']:.4f}s\n"
                f"  WebP Encoding Time:           {self.metrics['webp_encoding']:.4f}s"
            )

class ManifestManager:
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
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }

def parse_html_timeline(html_path):
    t0 = time.perf_counter()
    with open(html_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    soup = BeautifulSoup(content, "html.parser")
    tweets = {}
    author_handle = None

    articles = soup.find_all("article")
    if articles:
        for art in articles:
            h2 = art.find("h2")
            if not h2:
                continue
            
            tid_match = re.search(r'status/(\d{15,22})', str(h2)) or re.search(r'(\d{15,22})', h2.text)
            if not tid_match:
                continue
            tid_str = tid_match.group(1)

            p = art.find("p")
            user_val = ""
            date_val = ""
            if p:
                p_text = p.text
                u_m = re.search(r'User:\s*([^|]+)', p_text)
                if u_m:
                    user_val = u_m.group(1).strip()
                d_m = re.search(r'Date:\s*([^|]+)', p_text)
                if d_m:
                    date_val = d_m.group(1).strip()

            if user_val and not author_handle:
                author_handle = user_val

            pre = art.find("pre")
            text_val = pre.text.strip() if pre else ""

            tweets[tid_str] = {
                "tweet_id": tid_str,
                "user_name": user_val,
                "created_at": date_val,
                "full_text": text_val,
                "author_nick": user_val,
                "media": []
            }
        return tweets, author_handle, time.perf_counter() - t0

    h2_elements = soup.find_all("h2")
    for h2 in h2_elements:
        h2_text = h2.text.strip()
        tid_match = re.search(r'(?:ID:\s*)?(\d{15,22})', h2_text)
        if not tid_match:
            continue
        tid_str = tid_match.group(1)

        curr = h2.next_sibling
        text_val = ""
        user_val = ""
        date_val = ""

        while curr and getattr(curr, 'name', None) != 'h2':
            if getattr(curr, 'name', None) == 'h3':
                text_val = curr.text.strip()
            elif getattr(curr, 'name', None) == 'p':
                p_text = curr.text.strip()
                if 'Username:' in p_text:
                    user_val = p_text.replace('Username:', '').strip()
                elif 'User:' in p_text:
                    user_val = p_text.replace('User:', '').strip()
                elif 'Date:' in p_text:
                    date_val = p_text.replace('Date:', '').strip()
            curr = curr.next_sibling

        if user_val and not author_handle:
            author_handle = user_val

        tweets[tid_str] = {
            "tweet_id": tid_str,
            "user_name": user_val,
            "created_at": date_val,
            "full_text": text_val,
            "author_nick": user_val,
            "media": []
        }

    return tweets, author_handle, time.perf_counter() - t0

class TweetArchiveProcessorV2:
    def __init__(self, media_dir, html_file, out_dir, dry_run=False, workers=4, include_text_tweets=False, webp_quality=95, webp_method=4, filter_tids=None):
        self.media_dir = media_dir
        self.html_file = html_file
        self.out_dir = out_dir
        self.dry_run = dry_run
        self.workers = max(1, workers)
        self.include_text_tweets = include_text_tweets
        self.webp_quality = webp_quality
        self.webp_method = webp_method
        self.filter_tids = set(filter_tids) if filter_tids else None

        self.account_handle = os.path.basename(media_dir.rstrip(r"\/"))
        if self.account_handle.startswith("@"):
            self.account_handle = self.account_handle[1:]

        self.account_out_dir = self.resolve_output_dir()
        self.manifest = ManifestManager(self.account_out_dir)
            
        self.tweets = {}
        self.media_index = {}
        self.fallback_index = {}
        self.tid_to_paths = {}
        self.index_collisions = 0
        self.non_canonical_files = 0
        
        self.timing = TimingTracker()
        self.stats = {
            "tweets_total": 0,
            "snapshots_created": 0,
            "snapshots_skipped": 0,
            "success_full_media": 0,
            "success_partial_media": 0,
            "text_only_snapshots": 0,
            "media_referenced_unavailable": 0,
            "regenerated_with_new_media": 0,
            "missing_media_count": 0,
            "tweet_errors": 0,
            "media_total": 0,
            "media_found": 0
        }

    def resolve_output_dir(self):
        # Save directly in the same folder where the HTML & media files reside unless out_dir is explicitly given
        if not self.out_dir:
            return self.media_dir
        safe_handle = sanitize_filename(self.account_handle)
        if os.path.basename(self.out_dir) == f"@{safe_handle}":
            return self.out_dir
        return os.path.join(self.out_dir, f"@{safe_handle}")

    def load_data(self):
        if not os.path.exists(self.html_file):
            raise FileNotFoundError(f"HTML timeline file not found: {self.html_file}")

        m_idx, fb_idx, tid_paths, collisions, non_canon, idx_time = build_media_index(self.media_dir)
        self.media_index = m_idx
        self.fallback_index = fb_idx
        self.tid_to_paths = tid_paths
        self.index_collisions = collisions
        self.non_canonical_files = non_canon
        self.timing.add("media_indexing", idx_time)

        parsed_tweets, author_handle_found, parse_time = parse_html_timeline(self.html_file)
        self.timing.add("html_parsing", parse_time)

        if author_handle_found:
            self.account_handle = author_handle_found.replace("@", "")

        self.account_out_dir = self.resolve_output_dir()
        self.manifest = ManifestManager(self.account_out_dir)

        for tid_str, tdata in parsed_tweets.items():
            if self.filter_tids and tid_str not in self.filter_tids:
                continue

            local_paths = self.tid_to_paths.get(tid_str, [])
            media_list = []
            for lp in local_paths:
                m_fname = os.path.basename(lp)
                media_list.append({
                    "filename": m_fname,
                    "local_path": lp
                })

            tdata["media"] = media_list
            self.tweets[tid_str] = tdata

        self.stats["tweets_total"] = len(self.tweets)

    def render_perfect_tweet_svg(self, tweet_data, processed_media_items, display_date):
        """Exact Version 1 Dark-Theme Native SVG Tweet Card Builder."""
        tid = tweet_data["tweet_id"]
        display_name = escape_xml(tweet_data.get("author_nick") or self.account_handle)
        handle = escape_xml(f"@{self.account_handle}")
        
        replies = format_number(0)
        reposts = format_number(0)
        likes = format_number(0)
        views = format_number(0)

        text_lines = wrap_text_to_svg_lines(tweet_data.get("full_text", ""), max_chars=50)

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

    def process_tweet(self, tid_str, tweet_data):
        media_items = tweet_data.get("media", [])
        available_media = [m for m in media_items if m.get("local_path") and os.path.exists(m["local_path"])]
        
        is_text_only_tweet = (len(media_items) == 0)
        has_local_media = (len(available_media) > 0)
        has_missing_media = (len(media_items) > len(available_media))

        if not has_local_media:
            if not self.include_text_tweets:
                return "SKIPPED", None, 0, len(media_items)

        date_raw = tweet_data.get("created_at") or "2026-01-01 00:00:00"
        clean_date = date_raw.replace("T", " ").replace(":", "-").replace(" ", "_")
        if "_" not in clean_date:
            clean_date = f"{clean_date}_00-00-00"
        
        safe_handle = sanitize_filename(self.account_handle)
        snapshot_filename = f"{clean_date}_@{safe_handle}_{tid_str}.webp"
        snapshot_path = os.path.join(self.account_out_dir, snapshot_filename)

        available_count = len(available_media)
        missing_count = len(media_items) - available_count

        snapshot_exists = os.path.exists(snapshot_path) and os.path.getsize(snapshot_path) > 0
        was_regenerated = False

        if snapshot_exists:
            embedded_count = self.manifest.get_embedded_media_count(tid_str)
            if embedded_count < 0 and available_count > 0:
                was_regenerated = True
            elif embedded_count >= 0 and available_count > embedded_count:
                was_regenerated = True
            else:
                return "SKIPPED", snapshot_filename, 0, missing_count

        if self.dry_run:
            status = "SUCCESS_FULL_MEDIA" if not has_missing_media else "SUCCESS_PARTIAL_MEDIA"
            if is_text_only_tweet:
                status = "TEXT_ONLY_SNAPSHOT"
            return status, snapshot_filename, available_count, missing_count

        # Process media items into B64
        processed_media_items = []
        for m in available_media[:4]:
            lpath = m["local_path"]
            ext = os.path.splitext(lpath)[1].lower()
            is_vid = ext in (".mp4", ".mov", ".mkv", ".webm")

            media_info = get_image_dimensions_and_b64(lpath, is_video=is_vid, timer_stats=self.timing)
            processed_media_items.append(media_info)

        # Build SVG using exact V1 Dark Theme engine
        t0_svg = time.perf_counter()
        svg_content = self.render_perfect_tweet_svg(tweet_data, processed_media_items, date_raw)
        self.timing.add("svg_generation", time.perf_counter() - t0_svg)

        # Render SVG to PNG surface using resvg-py
        t0_resvg = time.perf_counter()
        try:
            png_bytes = resvg_py.svg_to_bytes(svg_content)
        except Exception as e:
            logger.error(f"resvg-py failed to render SVG for tweet {tid_str}: {e}")
            return "RENDER_ERROR", snapshot_filename, 0, missing_count
        self.timing.add("resvg_rendering", time.perf_counter() - t0_resvg)

        # Save WebP via Pillow
        t0_webp = time.perf_counter()
        try:
            with Image.open(io.BytesIO(png_bytes)) as pil_img:
                os.makedirs(self.account_out_dir, exist_ok=True)
                temp_path = f"{snapshot_path}.tmp.webp"
                pil_img.save(
                    temp_path,
                    format="WEBP",
                    quality=self.webp_quality,
                    method=self.webp_method
                )
                os.replace(temp_path, snapshot_path)
        except Exception as e:
            logger.error(f"Pillow WebP encoding failed for tweet {tid_str}: {e}")
            return "RENDER_ERROR", snapshot_filename, 0, missing_count
        self.timing.add("webp_encoding", time.perf_counter() - t0_webp)

        self.manifest.update_entry(tid_str, available_count)

        if was_regenerated:
            status = "REGENERATED_WITH_NEW_MEDIA"
        elif is_text_only_tweet:
            status = "TEXT_ONLY_SNAPSHOT"
        elif has_missing_media:
            status = "SUCCESS_PARTIAL_MEDIA"
        else:
            status = "SUCCESS_FULL_MEDIA"

        return status, snapshot_filename, available_count, missing_count

    def run(self):
        t_run_start = time.perf_counter()
        self.load_data()

        logger.info(f"\n==================================================")
        logger.info(f"Account Directory:     {os.path.basename(self.media_dir)}")
        logger.info(f"Handle / Username:     @{self.account_handle}")
        logger.info(f"HTML Timeline File:    {self.html_file}")
        logger.info(f"Output Directory:      {self.account_out_dir}")
        logger.info(f"Total HTML Tweets:     {len(self.tweets)}")
        logger.info(f"Include Text Tweets:   {self.include_text_tweets}")
        logger.info(f"WebP Encoding Setting: quality={self.webp_quality}, method={self.webp_method}")
        logger.info(f"==================================================\n")

        tweet_items = list(self.tweets.items())
        total_eval = len(tweet_items)
        completed_eval = 0

        with ThreadPoolExecutor(max_workers=self.workers) as executor:
            future_to_tid = {
                executor.submit(self.process_tweet, tid_str, tdata): tid_str
                for tid_str, tdata in tweet_items
            }

            for future in as_completed(future_to_tid):
                tid_str = future_to_tid[future]
                completed_eval += 1
                try:
                    status, filename, embedded_cnt, missing_cnt = future.result()
                    self.stats["missing_media_count"] += missing_cnt

                    if status == "SKIPPED":
                        self.stats["snapshots_skipped"] += 1
                    elif status == "RENDER_ERROR":
                        self.stats["tweet_errors"] += 1
                    else:
                        self.stats["snapshots_created"] += 1
                        if status == "SUCCESS_FULL_MEDIA":
                            self.stats["success_full_media"] += 1
                            logger.info(f"[{self.account_handle}] [OK] Created full media snapshot {filename}")
                        elif status == "SUCCESS_PARTIAL_MEDIA":
                            self.stats["success_partial_media"] += 1
                            logger.info(f"[{self.account_handle}] [OK] Created partial media snapshot {filename} ({missing_cnt} items missing)")
                        elif status == "TEXT_ONLY_SNAPSHOT":
                            self.stats["text_only_snapshots"] += 1
                            logger.info(f"[{self.account_handle}] [OK] Created text-only snapshot {filename}")
                        elif status == "REGENERATED_WITH_NEW_MEDIA":
                            self.stats["regenerated_with_new_media"] += 1
                            logger.info(f"[{self.account_handle}] [REGEN] Regenerated snapshot with new media {filename}")
                except Exception as e:
                    self.stats["tweet_errors"] += 1
                    logger.error(f"Unhandled error processing tweet {tid_str}: {e}")

                if completed_eval % 50 == 0 or completed_eval == total_eval:
                    logger.info(f"[{self.account_handle}] Progress: {completed_eval} / {total_eval} tweets evaluated")

        self.manifest.save()
        self.timing.metrics["total_run"] = time.perf_counter() - t_run_start

        logger.info(f"\n--------------------------------------------------")
        logger.info(f"ACCOUNT PROCESSING SUMMARY: @{self.account_handle}")
        logger.info(f"Total Tweets Evaluated:         {total_eval}")
        logger.info(f"Snapshots Created (Total):      {self.stats['snapshots_created']}")
        logger.info(f"  - Full Media Snapshots:       {self.stats['success_full_media']}")
        logger.info(f"  - Partial Media Snapshots:    {self.stats['success_partial_media']}")
        logger.info(f"  - Genuine Text-Only:          {self.stats['text_only_snapshots']}")
        logger.info(f"  - Unavailable Media Snapshots:{self.stats['media_referenced_unavailable']}")
        logger.info(f"  - Regenerated With New Media: {self.stats['regenerated_with_new_media']}")
        logger.info(f"Snapshots Skipped:              {self.stats['snapshots_skipped']}")
        logger.info(f"Rendering Errors:               {self.stats['tweet_errors']}")
        logger.info(f"Missing Local Media Items:      {self.stats['missing_media_count']}")
        logger.info(f"Media Index Collisions:         {self.index_collisions}")
        logger.info(f"Non-Canonical Media Files:      {self.non_canonical_files}")
        logger.info(f"--------------------------------------------------")
        logger.info(self.timing.report())
        logger.info(f"Output Directory:               {self.account_out_dir}")
        logger.info(f"--------------------------------------------------\n")

        return self.stats

def find_html_file_in_dir(account_dir):
    acc_name = os.path.basename(account_dir.rstrip(r"\/"))
    candidates = [
        os.path.join(account_dir, f"{acc_name}_tweets.html"),
        os.path.join(account_dir, "None_tweets.html"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c

    if os.path.exists(account_dir):
        for root, dirs, files in os.walk(account_dir):
            for f in files:
                if f.endswith(".html"):
                    return os.path.join(root, f)

    return None

def discover_accounts_v2(media_root):
    valid = []
    missing_html = []
    
    if not os.path.exists(media_root):
        return valid, missing_html

    for entry in os.listdir(media_root):
        if entry in EXCLUDED_DIRS or entry.lower() == "tweets":
            continue
        
        media_path = os.path.join(media_root, entry)
        if os.path.isdir(media_path):
            html_path = find_html_file_in_dir(media_path)
            if html_path:
                valid.append((entry, media_path, html_path))
            else:
                missing_html.append((entry, media_path))

    return valid, missing_html

def main():
    parser = argparse.ArgumentParser(description="Bulk Tweet Visual Archive Generator v2 (Browser-Free WebP Renderer - HTML Input)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--account", type=str, help="Single account directory name or path (e.g. onlymomson_in)")
    group.add_argument("--root", type=str, help="Root Media directory containing account subdirectories")
    
    parser.add_argument("--html-file", type=str, help="Custom path to HTML timeline file")
    parser.add_argument("--media-dir", type=str, default=DEFAULT_MEDIA_DIR, help="Path to Media directory")
    parser.add_argument("--output-dir", "--out-dir", dest="output_dir", type=str, default=None, help="Path to output directory (default: same directory as HTML & media files)")
    parser.add_argument("--include-text-tweets", action="store_true", help="Render text-only WebP snapshots for tweets without available media")
    parser.add_argument("--dry-run", action="store_true", help="Validation mode: inspect data without writing snapshots")
    parser.add_argument("--workers", type=int, default=4, help="Number of concurrent worker threads (default: 4)")
    parser.add_argument("--webp-quality", type=int, default=95, help="WebP quality parameter (1-100, default: 95)")
    parser.add_argument("--webp-method", type=int, default=4, help="WebP compression method (0-6, default: 4)")
    parser.add_argument("--log-file", type=str, default="archive_generator_v2.log", help="Path to output log file")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose debug logging")
    parser.add_argument("--tweet-ids", type=str, help="Comma-separated tweet IDs to process specifically for testing")

    args = parser.parse_args()
    setup_logging(args.log_file, args.verbose)

    filter_tids = [t.strip() for t in args.tweet_ids.split(",")] if args.tweet_ids else None

    if args.dry_run:
        logger.info("=== RUNNING IN DRY-RUN / VALIDATION MODE ===")

    if args.account:
        account_name = os.path.basename(args.account.rstrip(r"\/"))
        media_path = args.account if os.path.isabs(args.account) and os.path.isdir(args.account) else os.path.join(args.media_dir, account_name)
        
        if not os.path.exists(media_path) and os.path.exists(args.account):
            media_path = args.account

        if not os.path.exists(media_path):
            logger.error(f"Single account media path not found: {media_path}")
            sys.exit(1)

        html_path = args.html_file or find_html_file_in_dir(media_path)
        if not html_path or not os.path.exists(html_path):
            logger.error(f"HTML timeline file not found in account directory: {media_path}")
            sys.exit(1)

        processor = TweetArchiveProcessorV2(
            media_dir=media_path,
            html_file=html_path,
            out_dir=args.output_dir,
            dry_run=args.dry_run,
            workers=args.workers,
            include_text_tweets=args.include_text_tweets,
            webp_quality=args.webp_quality,
            webp_method=args.webp_method,
            filter_tids=filter_tids
        )
        processor.run()

    elif args.root:
        media_root = args.root
        valid_accounts, missing_html = discover_accounts_v2(media_root)
        
        logger.info(f"Discovered {len(valid_accounts)} valid account directories in {media_root}")
        if missing_html:
            logger.warning(f"Found {len(missing_html)} account directories without HTML timeline files:")
            for acc, m_path in missing_html:
                logger.warning(f"  - Directory: {acc} | Path: {m_path}")

        total_stats = {
            "accounts_processed": 0,
            "tweets_total": 0,
            "snapshots_created": 0,
            "snapshots_skipped": 0,
            "tweet_errors": 0,
            "missing_media_count": 0,
            "regenerated_with_new_media": 0
        }

        for acc_name, media_path, html_path in valid_accounts:
            try:
                processor = TweetArchiveProcessorV2(
                    media_dir=media_path,
                    html_file=html_path,
                    out_dir=args.output_dir,
                    dry_run=args.dry_run,
                    workers=args.workers,
                    include_text_tweets=args.include_text_tweets,
                    webp_quality=args.webp_quality,
                    webp_method=args.webp_method,
                    filter_tids=filter_tids
                )
                stats = processor.run()
                total_stats["accounts_processed"] += 1
                total_stats["tweets_total"] += stats["tweets_total"]
                total_stats["snapshots_created"] += stats["snapshots_created"]
                total_stats["snapshots_skipped"] += stats["snapshots_skipped"]
                total_stats["tweet_errors"] += stats["tweet_errors"]
                total_stats["missing_media_count"] += stats["missing_media_count"]
                total_stats["regenerated_with_new_media"] += stats["regenerated_with_new_media"]
            except Exception as e:
                logger.error(f"Failed to process account {acc_name}: {e}")

        logger.info(f"\n==================================================")
        logger.info(f"FINAL ROOT BATCH SUMMARY (v2 HTML Pipeline)")
        logger.info(f"Accounts Processed:         {total_stats['accounts_processed']}")
        logger.info(f"Total Tweets Evaluated:     {total_stats['tweets_total']}")
        logger.info(f"Snapshots Created:          {total_stats['snapshots_created']}")
        logger.info(f"Regenerated With New Media: {total_stats['regenerated_with_new_media']}")
        logger.info(f"Snapshots Skipped:          {total_stats['snapshots_skipped']}")
        logger.info(f"Total Errors:               {total_stats['tweet_errors']}")
        logger.info(f"Missing Local Media Items:  {total_stats['missing_media_count']}")
        logger.info(f"==================================================\n")

if __name__ == "__main__":
    main()
