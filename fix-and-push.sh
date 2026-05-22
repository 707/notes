#!/bin/bash
# Remove large zip file and push to GitHub

set -e
cd /Users/nad/Documents/Tests/notes

echo "==================================="
echo "Fixing large file issue"
echo "==================================="
echo ""

# Remove the zip file from git (keep local copy)
echo "1. Removing gloss-chrome-extension-v1.0.0.zip from git..."
git rm --cached gloss-chrome-extension-v1.0.0.zip
echo ""

# Add to gitignore
echo "2. Adding zip files to .gitignore..."
echo "" >> .gitignore
echo "# Distribution zip files" >> .gitignore
echo "*.zip" >> .gitignore
echo ""

# Commit the removal
echo "3. Committing changes..."
git commit -m "Remove large zip file from git tracking

- Remove gloss-chrome-extension-v1.0.0.zip (11MB)
- Add *.zip to .gitignore
- Distribution files should not be in git history

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
echo ""

# Increase buffer size for large push
echo "4. Increasing HTTP buffer size..."
git config http.postBuffer 524288000
echo ""

# Push to GitHub
echo "5. Pushing to GitHub..."
git push --force origin main
echo ""

echo "==================================="
echo "✅ Successfully pushed to GitHub!"
echo "==================================="
echo ""
echo "Note: The zip file is still on your local disk,"
echo "it's just no longer tracked by git."
