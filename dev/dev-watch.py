#!/usr/bin/env python3
"""
Hot Reload Dev Script for Chrome Extension
Watches for file changes and triggers extension reload via Chrome DevTools Protocol
"""
import os
import sys
import time
import hashlib
import json
from pathlib import Path

# Files to watch
WATCH_EXTENSIONS = ['.js', '.html', '.css', '.json']
WATCH_DIR = Path(__file__).parent
IGNORE_FILES = ['dev-watch.py', 'create-icons.py']

print("🔥 Hot Reload Watcher Started")
print(f"📁 Watching directory: {WATCH_DIR}")
print(f"🎯 Watching files: {', '.join(WATCH_EXTENSIONS)}")
print("-" * 50)

def get_file_hash(filepath):
    """Get MD5 hash of file contents"""
    try:
        with open(filepath, 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()
    except Exception:
        return None

def get_all_watched_files():
    """Get all files to watch with their hashes"""
    files = {}
    for ext in WATCH_EXTENSIONS:
        for filepath in WATCH_DIR.rglob(f'*{ext}'):
            # Skip ignored files
            if filepath.name in IGNORE_FILES:
                continue
            # Get relative path
            rel_path = filepath.relative_to(WATCH_DIR)
            files[str(rel_path)] = get_file_hash(filepath)
    return files

def print_reload_instructions():
    """Print instructions for manual reload"""
    print("\n" + "=" * 50)
    print("🔄 FILES CHANGED - RELOAD NEEDED")
    print("=" * 50)
    print("\n📌 To reload your extension:")
    print("   1. Open chrome://extensions")
    print("   2. Click the reload icon (🔄) for 'Gloss'")
    print("\n💡 TIP: Keep the extensions page open in a pinned tab")
    print("   for quick reloading during development")
    print("\n" + "-" * 50 + "\n")

# Initial file snapshot
file_hashes = get_all_watched_files()
print(f"✅ Watching {len(file_hashes)} files\n")

# Watch loop
try:
    while True:
        time.sleep(1)  # Check every second

        # Get current state
        current_hashes = get_all_watched_files()

        # Check for changes
        changed_files = []

        # Check modified files
        for filepath, hash_val in current_hashes.items():
            if filepath not in file_hashes or file_hashes[filepath] != hash_val:
                changed_files.append(filepath)

        # Check deleted files
        for filepath in file_hashes:
            if filepath not in current_hashes:
                changed_files.append(f"{filepath} (deleted)")

        if changed_files:
            print(f"🔔 Detected changes in:")
            for filepath in changed_files:
                print(f"   • {filepath}")

            print_reload_instructions()

            # Update file hashes
            file_hashes = current_hashes

except KeyboardInterrupt:
    print("\n\n👋 Hot reload watcher stopped")
    sys.exit(0)
