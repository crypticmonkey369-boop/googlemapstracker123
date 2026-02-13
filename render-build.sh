#!/usr/bin/env bash
# exit on error
set -o errexit

# Install dependencies
npm install

# Install Chrome for Puppeteer into the cache directory
# We use the same path as in render.yaml
echo "Installing Puppeteer browser..."
PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer npx puppeteer install chrome
