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

            // Robust link extraction
            const currentLinks = await page.evaluate(() => {
                // Link patterns: search for anchors containing place info
                const selectors = [
                    'a[href*="/maps/place/"]',
                    'a.hfpxzc',
                    'div.Nv2Ybe a',
                    '[role="article"] a'
                ];

                const links = new Set();
                selectors.forEach(sel => {
                    document.querySelectorAll(sel).forEach(a => {
                        if (a.href && a.href.includes('/maps/place/')) {
                            links.add(a.href);
                        }
                    });
                });
                return Array.from(links);
            });

            const currentCount = currentLinks.length;
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

            // Check if end reached
            const isEnd = await page.evaluate(() => {
                return document.body.innerText.includes("reached the end") ||
                    document.body.innerText.includes("No more results");
            });
            if (isEnd) break;
        }

        // Final Extraction Phase
        let listingLinks = await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('a[href*="/maps/place/"]').forEach(a => links.add(a.href));
            return Array.from(links);
        });

        listingLinks = listingLinks.slice(0, MAX_LEADS);

        if (listingLinks.length === 0) {
            throw new Error("Google Maps returned 0 results for this area. Try a broader category.");
        }

        onProgress({
            status: 'extracting',
            message: `Extracting detailed info for ${listingLinks.length} businesses...`,
            total: listingLinks.length,
        });

        for (let i = 0; i < listingLinks.length; i++) {
            try {
                onProgress({
                    status: 'extracting',
                    message: `Detailing ${i + 1} of ${listingLinks.length}: ${listingLinks[i].split('/')[5]?.replace(/\+/g, ' ')}`,
                    current: i + 1,
                    total: listingLinks.length,
                });

                await page.goto(listingLinks[i], { waitUntil: 'networkidle2', timeout: 30000 });
                await delay(2000);

                const businessData = await page.evaluate((cat) => {
                    const data = {
                        category: cat,
                        name: document.querySelector('h1')?.textContent?.trim() || 'Unknown',
                        address: '',
                        phone: '',
                        website: '',
                        rating: '',
                        reviews: '',
                    };

                    // Scrape Rating
                    const ratingSpan = document.querySelector('span[role="img"][aria-label*="stars"]');
                    if (ratingSpan) data.rating = ratingSpan.getAttribute('aria-label').split(' ')[0];

                    // Scrape Reviews count
                    const reviewsBtn = document.querySelector('button[aria-label*="reviews"]');
                    if (reviewsBtn) data.reviews = reviewsBtn.getAttribute('aria-label').replace(/[^0-9]/g, '');

                    // Helper to find data by icon/type
                    const infoButtons = document.querySelectorAll('button[data-item-id]');
                    infoButtons.forEach(btn => {
                        const id = btn.getAttribute('data-item-id');
                        const label = btn.getAttribute('aria-label') || '';

                        if (id?.includes('address')) data.address = label.replace('Address: ', '');
                        if (id?.includes('phone')) data.phone = label.replace('Phone: ', '');
                        if (id?.includes('authority')) {
                            const link = btn.querySelector('a');
                            if (link) data.website = link.href;
                        }
                    });

                    // Fallback for website
                    if (!data.website) {
                        const webLink = document.querySelector('a[data-item-id="authority"]');
                        if (webLink) data.website = webLink.href;
                    }

                    return data;
                }, category);

                if (businessData.name !== 'Unknown') {
                    results.push(businessData);
                }
            } catch (err) {
                console.log(`Skip listing ${i}: ${err.message}`);
            }
        }

        onProgress({
            status: 'complete',
            message: `Scraping finished! ${results.length} leads are ready.`,
            count: results.length,
        });

        return results;
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
