#!/bin/bash
# Chrome Extension Distribution Packager
# Creates a clean chrome-clipper.zip for distribution

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_NAME="gloss-chrome-extension"
DIST_VERSION=$(grep '"version"' manifest.json | sed 's/.*"version": "\(.*\)".*/\1/')
OUTPUT_FILE="${DIST_NAME}-v${DIST_VERSION}.zip"

echo "📦 Gloss Chrome Extension Packager"
echo "=================================="
echo "Version: ${DIST_VERSION}"
echo "Output: ${OUTPUT_FILE}"
echo ""

# Check if zip command exists
if ! command -v zip &> /dev/null; then
    echo "❌ Error: 'zip' command not found"
    exit 1
fi

# Check if .distignore exists
if [ ! -f .distignore ]; then
    echo "❌ Error: .distignore file not found"
    exit 1
fi

# Clean previous build
if [ -f "$OUTPUT_FILE" ]; then
    echo "🗑️  Removing previous build: $OUTPUT_FILE"
    rm "$OUTPUT_FILE"
fi

echo "🔨 Creating distribution package..."
cd "$SCRIPT_DIR"

# Create zip with explicit exclusions for cleaner distribution
zip -r "$OUTPUT_FILE" . \
  -x "dev/*" \
  -x "docs/*" \
  -x "landing/*" \
  -x "landing2/*" \
  -x "landing3/*" \
  -x "releases/*" \
  -x "scripts/*" \
  -x ".claude/*" \
  -x ".git/*" \
  -x ".git-original-backup/*" \
  -x ".gemini/*" \
  -x ".gitignore" \
  -x "*.bak*" \
  -x "*.DS_Store" \
  -x "*.zip" \
  -x ".distignore" \
  -x "package.sh" \
  -x "fix-and-push.sh" \
  -x "push-to-github.sh" \
  -x "simple-push-fix.sh" \
  -x "logo-generator.html" \
  -x "RESTRUCTURE_HISTORY.md" \
  -x "USER.MD" \
  -x "node_modules/*" \
  -x "*/node_modules/*" \
  -x "package-lock.json"

# Get file size
SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)

echo ""
echo "✅ Package created successfully!"
echo "📦 File: $OUTPUT_FILE"
echo "📊 Size: $SIZE"
echo ""
echo "🚀 Ready for:"
echo "   - Chrome Web Store upload"
echo "   - Manual distribution"
echo "   - Testing in chrome://extensions"
echo ""
echo "📝 To test:"
echo "   1. Unzip $OUTPUT_FILE to a new folder"
echo "   2. Open chrome://extensions"
echo "   3. Enable Developer Mode"
echo "   4. Click 'Load unpacked' and select the folder"
