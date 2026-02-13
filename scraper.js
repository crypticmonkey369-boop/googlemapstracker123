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
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

    let browser;
    const results = [];

    try {
        onProgress({ status: 'launching', message: 'Launching browser...' });

        browser = await puppeteer.launch({
            headless: true,
            timeout: 60000,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--lang=en-US',
            ],
        });

        const page = await browser.newPage();

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        await page.setViewport({ width: 1920, height: 1080 });

        onProgress({ status: 'navigating', message: `Searching Google Maps for "${query}"...` });

        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for results to load
        await delay(3000);

        // Try to accept cookies if prompted
        try {
            const acceptBtn = await page.$('button[aria-label="Accept all"]');
            if (acceptBtn) {
                await acceptBtn.click();
                await delay(1000);
            }
        } catch (e) {
            // Cookies prompt not found, continue
        }

        onProgress({ status: 'scrolling', message: 'Loading business listings...' });

        // Find the scrollable results panel
        const scrollableSelector = 'div[role="feed"]';
        await page.waitForSelector(scrollableSelector, { timeout: 15000 }).catch(() => null);

        // Scroll to load more results
        let previousCount = 0;
        let scrollAttempts = 0;
        const maxScrollAttempts = 15;

        while (scrollAttempts < maxScrollAttempts) {
            // Scroll the results panel
            await page.evaluate((selector) => {
                const el = document.querySelector(selector);
                if (el) {
                    el.scrollTop = el.scrollHeight;
                }
            }, scrollableSelector);

            await delay(2000 + Math.random() * 1000);

            // Count current results
            const currentCount = await page.evaluate(() => {
                return document.querySelectorAll('div[role="feed"] > div > div > a').length;
            });

            onProgress({
                status: 'scrolling',
                message: `Found ${currentCount} listings so far... (max ${MAX_LEADS})`,
                count: currentCount,
            });

            // Stop if we've reached the limit
            if (currentCount >= MAX_LEADS) break;

            // Check if we've stopped finding new results
            if (currentCount === previousCount) {
                scrollAttempts++;
                if (scrollAttempts >= 3) break;
            } else {
                scrollAttempts = 0;
            }

            previousCount = currentCount;

            // Check for "end of results" indicator
            const endOfResults = await page.evaluate(() => {
                const text = document.body.innerText;
                return text.includes("You've reached the end of the list");
            });

            if (endOfResults) break;
        }

        onProgress({ status: 'extracting', message: 'Extracting business details...' });

        // Get all listing links (capped at MAX_LEADS)
        let listingLinks = await page.evaluate(() => {
            const links = document.querySelectorAll('div[role="feed"] > div > div > a');
            return Array.from(links)
                .map((a) => a.href)
                .filter((href) => href && href.includes('/maps/place/'));
        });

        listingLinks = listingLinks.slice(0, MAX_LEADS);

        onProgress({
            status: 'extracting',
            message: `Found ${listingLinks.length} listings (limit: ${MAX_LEADS}). Extracting details...`,
            total: listingLinks.length,
        });

        // Visit each listing to extract details
        for (let i = 0; i < listingLinks.length; i++) {
            try {
                onProgress({
                    status: 'extracting',
                    message: `Extracting business ${i + 1} of ${listingLinks.length}...`,
                    current: i + 1,
                    total: listingLinks.length,
                });

                await page.goto(listingLinks[i], { waitUntil: 'networkidle2', timeout: 20000 });
                await delay(1500 + Math.random() * 1000);

                const businessData = await page.evaluate((cat) => {
                    const data = {
                        category: cat,
                        name: '',
                        address: '',
                        phone: '',
                        email: '',
                        website: '',
                        rating: '',
                        reviews: '',
                    };

                    // Business name
                    const nameEl = document.querySelector('h1');
                    if (nameEl) data.name = nameEl.textContent.trim();

                    // Rating and Reviews
                    const ratingEl = document.querySelector('span[role="img"][aria-label*="stars"]');
                    if (ratingEl) {
                        data.rating = ratingEl.getAttribute('aria-label').split(' ')[0];
                    }
                    const reviewsBtn = document.querySelector('button[aria-label*="reviews"]');
                    if (reviewsBtn) {
                        data.reviews = reviewsBtn.getAttribute('aria-label').replace(/[^0-9]/g, '');
                    }

                    // Extract from info buttons/links
                    const buttons = document.querySelectorAll('button[data-item-id]');
                    buttons.forEach((btn) => {
                        const itemId = btn.getAttribute('data-item-id');
                        const text = btn.textContent.trim();
                        const ariaLabel = btn.getAttribute('aria-label') || '';

                        if (itemId === 'address' || itemId?.startsWith('address')) {
                            data.address = ariaLabel.replace('Address: ', '') || text;
                        }
                        if (itemId === 'phone' || itemId?.startsWith('phone')) {
                            data.phone = ariaLabel.replace('Phone: ', '') || text;
                        }
                    });

                    // Try to get address from aria-label
                    if (!data.address) {
                        const addressBtn = document.querySelector('button[data-item-id="address"]') ||
                            document.querySelector('[data-tooltip="Copy address"]');
                        if (addressBtn) {
                            data.address = addressBtn.getAttribute('aria-label')?.replace('Address: ', '') ||
                                addressBtn.textContent.trim();
                        }
                    }

                    // Try to get phone from aria-label
                    if (!data.phone) {
                        const phoneBtn = document.querySelector('button[data-item-id^="phone"]') ||
                            document.querySelector('[data-tooltip="Copy phone number"]');
                        if (phoneBtn) {
                            data.phone = phoneBtn.getAttribute('aria-label')?.replace('Phone: ', '') ||
                                phoneBtn.textContent.trim();
                        }
                    }

                    // Website
                    const websiteLink = document.querySelector('a[data-item-id="authority"]') ||
                        document.querySelector('[data-tooltip="Open website"]');
                    if (websiteLink) {
                        data.website = websiteLink.href || websiteLink.textContent.trim();
                    }

                    return data;
                }, category);

                if (businessData.name) {
                    results.push(businessData);
                }
            } catch (err) {
                console.log(`Failed to extract listing ${i + 1}: ${err.message}`);
            }
        }

        onProgress({
            status: 'complete',
            message: `Successfully extracted ${results.length} businesses`,
            count: results.length,
        });

        return results;
    } catch (error) {
        console.error('Scraping error:', error.message);
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
