const puppeteer = require('puppeteer');

/**
 * Scrapes Google Maps for business listings based on category, state, and country.
 * @param {string} category - Business category (e.g., "Dentists")
 * @param {string} state - State/region (e.g., "California")
 * @param {string} country - Country (e.g., "USA")
 * @param {number} maxLeads - Maximum number of leads to scrape (1-100)
 * @param {function} onProgress - Callback for progress updates
 * @returns {Promise<Array>} Array of business objects
 */
async function scrapeGoogleMaps(category, state, country, maxLeads = 100, onProgress = () => { }) {
    const MAX_LEADS = Math.min(Math.max(parseInt(maxLeads, 10) || 100, 1), 100);

    const query = `${category} in ${state}, ${country}`;
    // Force English UI for consistent selectors
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;

    let browser;
    const results = [];

    try {
        onProgress({ status: 'launching', message: 'Launching global scraper engine...' });

        browser = await puppeteer.launch({
            headless: true,
            timeout: 60000,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--window-size=1920,1080',
                '--lang=en-US,en;q=0.9',
            ],
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        onProgress({ status: 'navigating', message: `Searching for "${category}" in "${state}"...` });

        // Go to page with longer timeout
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 90000 });
        await delay(5000); // Give it a moment to settle

        // Handle Cookie Consent (Crucial on cloud IPs)
        try {
            const consentSelectors = [
                'button[aria-label="Accept all"]',
                'button[aria-label="Accept everything"]',
                'form[action^="https://consent.google.com"] button',
                'button.VfPpkd-LgIVId-L9o7Wf'
            ];
            for (const sel of consentSelectors) {
                const btn = await page.$(sel);
                if (btn) {
                    await btn.click();
                    await delay(2000);
                    break;
                }
            }
        } catch (e) {
            console.log("Consent skip or not found");
        }

        onProgress({ status: 'scrolling', message: 'Detecting Google Maps results layout...' });

        // Scrolling Logic
        let previousCount = 0;
        let scrollAttempts = 0;
        const maxScrollAttempts = 25;
        let fastResults = [];

        while (scrollAttempts < maxScrollAttempts) {
            // Try scrolling the feed area
            await page.evaluate(() => {
                const feed = document.querySelector('div[role="feed"]') ||
                    document.querySelector('.m67qEc') ||
                    document.querySelector('.section-scrollbox') ||
                    window;

                if (feed === window) {
                    window.scrollBy(0, 1000);
                } else {
                    feed.scrollTop = feed.scrollHeight;
                }
            });

            await delay(2500);

            // Fast Extraction from List View (Captures data immediately)
            const pageData = await page.evaluate((cat) => {
                const results = [];
                // Look for common business item containers in Maps
                const items = document.querySelectorAll('div[role="article"], .Nv2Ybe, .m67qEc > div > div');

                items.forEach(item => {
                    const link = item.querySelector('a[href*="/maps/place/"]');
                    const nameEl = item.querySelector('.qBF1Pd') || item.querySelector('.fontHeadlineSmall');
                    const name = nameEl ? nameEl.textContent.trim() : (item.getAttribute('aria-label') || '');

                    if (link && name) {
                        // Extract basic stats from the list view text labels
                        const statsText = item.querySelector('.MW4etd')?.textContent || '';
                        const reviewsText = item.querySelector('.UY7F9')?.textContent || '';

                        // Address often appears in text blocks with specific classes
                        const infoLines = Array.from(item.querySelectorAll('.W4Efsd')).map(el => el.textContent.trim());
                        const address = infoLines[1] || '';

                        results.push({
                            category: cat,
                            name: name,
                            url: link.href,
                            address: address,
                            rating: statsText,
                            reviews: reviewsText.replace(/[^0-9]/g, ''),
                            phone: '',
                            website: ''
                        });
                    }
                });
                return results;
            }, category);

            // Merge unique found results
            pageData.forEach(item => {
                if (!fastResults.find(r => r.url === item.url)) {
                    fastResults.push(item);
                }
            });

            const currentCount = fastResults.length;
            onProgress({
                status: 'scrolling',
                message: `Found ${currentCount} business listings...`,
                count: currentCount,
            });

            if (currentCount >= MAX_LEADS) break;

            if (currentCount === previousCount) {
                scrollAttempts++;
                if (scrollAttempts >= 5) break;
            } else {
                scrollAttempts = 0;
            }
            previousCount = currentCount;

            const isEnd = await page.evaluate(() => {
                const bodyText = document.body.innerText;
                return bodyText.includes("reached the end") || bodyText.includes("No more results");
            });
            if (isEnd) break;
        }

        // Final detail extraction (Optional but helpful for missing fields)
        const listingLinks = fastResults.slice(0, MAX_LEADS);

        if (listingLinks.length === 0) {
            throw new Error("No businesses found in this area. Please try a different category or broader location.");
        }

        onProgress({
            status: 'extracting',
            message: `Updating details for ${listingLinks.length} leads...`,
            total: listingLinks.length,
        });

        const finalResults = [];
        for (let i = 0; i < listingLinks.length; i++) {
            const currentItem = listingLinks[i];
            try {
                onProgress({
                    status: 'extracting',
                    message: `Checking ${i + 1}/${listingLinks.length}: ${currentItem.name}`,
                    current: i + 1,
                    total: listingLinks.length,
                });

                // Only visit detail page if we are missing critical info like phone or website
                await page.goto(currentItem.url, { waitUntil: 'networkidle2', timeout: 30000 });
                await delay(2000);

                const details = await page.evaluate(() => {
                    const d = { phone: '', website: '', address: '' };
                    const btns = document.querySelectorAll('button[data-item-id]');
                    btns.forEach(btn => {
                        const id = btn.getAttribute('data-item-id');
                        const label = btn.getAttribute('aria-label') || '';
                        if (id?.includes('phone')) d.phone = label.replace('Phone: ', '');
                        if (id?.includes('address')) d.address = label.replace('Address: ', '');
                        if (id?.includes('authority')) {
                            const a = btn.querySelector('a');
                            if (a) d.website = a.href;
                        }
                    });
                    if (!d.website) {
                        const w = document.querySelector('a[data-item-id="authority"]');
                        if (w) d.website = w.href;
                    }
                    return d;
                });

                finalResults.push({
                    ...currentItem,
                    phone: details.phone || currentItem.phone,
                    website: details.website || currentItem.website,
                    address: details.address || currentItem.address
                });
            } catch (err) {
                console.log(`Fallback for ${currentItem.name}: Using list data only.`);
                finalResults.push(currentItem);
            }
        }

        onProgress({
            status: 'complete',
            message: `Scraping complete! ${finalResults.length} leads found.`,
            count: finalResults.length,
        });

        return finalResults;
    } catch (error) {
        console.error('CRITICAL SCRAPING ERROR:', error.message);
        console.error('Stack:', error.stack);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { scrapeGoogleMaps };
