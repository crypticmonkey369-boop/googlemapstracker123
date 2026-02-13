#!/usr/bin/env bash
# exit on error
set -o errexit

npm install
# This will use the .puppeteerrc.cjs settings
npx puppeteer browsers install chrome
