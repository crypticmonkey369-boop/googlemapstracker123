#!/usr/bin/env bash
# exit on error
set -o errexit

npm install
npx puppeteer install --cache /opt/render/project/puppeteer
