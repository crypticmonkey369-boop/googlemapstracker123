# 🗺️ Google Maps Lead Scraper (Pro Edition)

A professional-grade lead generation tool designed specifically for high-reliability scraping on cloud infrastructure.

## 🚀 Key Features
- **Stealth Integration**: Uses `puppeteer-extra-plugin-stealth` to bypass bot detection.
- **Cloud Optimized**: Custom-tuned for Render/Heroku with specialized browser caching.
- **Fast Extraction**: Grabs basic leads instantly from the search list, then enriches them in the background.
- **Excel Export**: Generates professional `.xlsx` files with custom ice-breaker messages.

## 🛠️ Maintenance & Stability
This project is currently "frozen" in a perfectly working state. To keep it that way:

1. **Deployment**: Always use **"Manual Deploy > Clear Cache and Deploy"** if you make changes.
2. **Settings**: Do not change the `PUPPETEER_CACHE_DIR` environment variable.
3. **Dependencies**: The versions in `package.json` are locked to ensure compatibility.

## 📁 Project Structure
- `server.js`: The Express API and job manager.
- `scraper.js`: The high-intensity scraping engine (Stealth Mode).
- `validator.js`: Handles data cleaning and Ice-Breaker logic.
- `excelGenerator.js`: Transforms leads into beautiful Excel reports.
- `public/`: The premium frontend dashboard.

---
*Created with ❤️ for high-performance lead generation.*
