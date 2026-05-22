#!/bin/bash
# Script to update GitHub with restructured repository

set -e  # Exit on error

echo "==================================="
echo "Updating GitHub with restructured repo"
echo "==================================="
echo ""

# Navigate to repository root
cd /Users/nad/Documents/Tests/notes

echo "1. Checking current state..."
git status
echo ""

echo "2. Checking commit count..."
COMMIT_COUNT=$(git log --oneline | wc -l | tr -d ' ')
echo "Commits: $COMMIT_COUNT (expected: ~103)"
echo ""

echo "3. Checking remote configuration..."
git remote -v
echo ""

# Check if origin exists
if git remote | grep -q "^origin$"; then
    echo "Remote 'origin' already exists"
else
    echo "4. Adding remote origin..."
    git remote add origin https://github.com/707/gloss.git
    echo "Remote added successfully"
fi
echo ""

echo "5. Verifying remote..."
git remote -v
echo ""

echo "==================================="
echo "Ready to push to GitHub"
echo "==================================="
echo ""
echo "This will OVERWRITE GitHub history (118 commits → 103 commits)"
echo "This is IRREVERSIBLE once pushed"
echo ""
read -p "Do you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" = "yes" ]; then
    echo ""
    echo "6. Force pushing to GitHub..."
    git push --force-with-lease origin main
    echo ""
    echo "==================================="
    echo "✅ Successfully pushed to GitHub!"
    echo "==================================="
    echo ""
    echo "Next steps:"
    echo "1. Visit https://github.com/707/gloss"
    echo "2. Verify files are at root (no chrome-clipper/ directory)"
    echo "3. Check commit count is ~103"
    echo "4. Verify extension files visible (manifest.json, panel.js, etc.)"
else
    echo ""
    echo "Push cancelled. No changes made to GitHub."
    echo ""
    echo "To push later, run:"
    echo "  cd /Users/nad/Documents/Tests/notes"
    echo "  git push --force-with-lease origin main"
fi
