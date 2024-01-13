#!/bin/bash

if [ $# -eq 0 ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

# Argument is the new version
new_version=$1

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: There are uncommitted changes. Please commit or stash them before bumping the version."
  exit 1
fi

# Update version in package.json
sed -i '' -e "s/\"version\": \".*\"/\"version\": \"$new_version\"/" package.json

# Install dependencies
npm install

# Stage changes
git add package.json
git add package-lock.json

# Commit changes
git commit -m "Bump version to $new_version"

# Create Git tag
git tag -a v$new_version -m "Version $new_version"

# Push changes and tags to the repository
git push origin main
git push origin v$new_version
