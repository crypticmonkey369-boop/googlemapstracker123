#!/usr/bin/env bash
# exit on error
set -o errexit

npm install
# This line ensures Chromium is downloaded and the libraries are available
# In Render's Node environment, we might need to install additional libs
# But standard puppeteer install usually works if the environment is Ubuntu-based
# This command is a fallback to make sure
npx puppeteer install
