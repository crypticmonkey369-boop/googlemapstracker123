const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());


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
        onProgress({ status: 'launching', message: 'Initializing Stealth Scraper Engine...' });

        browser = await puppeteer.launch({
            headless: true,
            timeout: 60000,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1920,1080',
            ],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        onProgress({ status: 'navigating', message: `Searching for "${category}"...` });

        // Use a more patient navigation
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await delay(5000);

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

        let fastResults = [];
        let previousCount = 0;
        let noNewCount = 0;

        onProgress({ status: 'scrolling', message: 'Scanning Google Maps listings...' });

        // Scrolling and collection loop
        for (let i = 0; i < 20; i++) { // Up to 20 scroll attempts
            const currentData = await page.evaluate((cat) => {
                const results = [];
                // Find all possible business containers
                const items = document.querySelectorAll('div[role="article"], a[href*="/maps/place/"], .Nv2Ybe');

                items.forEach(item => {
                    let url = '';
                    let name = '';

                    if (item.tagName === 'A') {
                        url = item.href;
                        name = item.getAttribute('aria-label') || '';
                    } else {
                        const link = item.querySelector('a[href*="/maps/place/"]');
                        if (link) {
                            url = link.href;
                            name = item.querySelector('.qBF1Pd')?.textContent || item.querySelector('.fontHeadlineSmall')?.textContent || link.getAttribute('aria-label') || '';
                        }
                    }

                    if (url && url.includes('/maps/place/') && name) {
                        results.push({
                            category: cat,
                            name: name.trim(),
                            url: url,
                            address: '', // Will populate from list if possible
                            rating: '',
                            reviews: '',
                            phone: '',
                            website: ''
                        });
                    }
                });
                return results;
            }, category);

            // Deduplicate and add
            currentData.forEach(item => {
                if (!fastResults.find(r => r.url === item.url)) {
                    fastResults.push(item);
                }
            });

            if (fastResults.length >= MAX_LEADS) break;

            if (fastResults.length === previousCount) {
                noNewCount++;
                if (noNewCount >= 4) break;
            } else {
                noNewCount = 0;
            }
            previousCount = fastResults.length;

            onProgress({
                status: 'scrolling',
                message: `Found ${fastResults.length} businesses...`,
                count: fastResults.length
            });

            // Scroll the results panel
            await page.evaluate(() => {
                const feed = document.querySelector('div[role="feed"]') ||
                    document.querySelector('.m67qEc') ||
                    document.querySelector('.section-scrollbox') ||
                    window;
                if (feed === window) window.scrollBy(0, 800);
                else feed.scrollTop = feed.scrollHeight;
            });
            await delay(2000);
        }

        const finalLeads = fastResults.slice(0, MAX_LEADS);

        if (finalLeads.length === 0) {
            throw new Error("No businesses found. Try a different category or location.");
        }

        onProgress({ status: 'extracting', message: `Detailing ${finalLeads.length} leads...`, total: finalLeads.length });

        const detailedResults = [];
        for (let i = 0; i < finalLeads.length; i++) {
            const lead = finalLeads[i];
            try {
                onProgress({
                    status: 'extracting',
                    message: `Extracting ${i + 1}/${finalLeads.length}: ${lead.name}`,
                    current: i + 1,
                    total: finalLeads.length
                });

                await page.goto(lead.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await delay(2000);

                const info = await page.evaluate(() => {
                    const d = { address: '', phone: '', website: '', rating: '', reviews: '' };

                    // Rating/Reviews
                    const r = document.querySelector('span[role="img"][aria-label*="stars"]');
                    if (r) d.rating = r.getAttribute('aria-label').split(' ')[0];
                    const rev = document.querySelector('button[aria-label*="reviews"]');
                    if (rev) d.reviews = rev.getAttribute('aria-label').replace(/[^0-9]/g, '');

                    // Address, Phone, Website
                    document.querySelectorAll('button[data-item-id]').forEach(btn => {
                        const id = btn.getAttribute('data-item-id');
                        const label = btn.getAttribute('aria-label') || '';
                        if (id?.includes('address')) d.address = label.replace('Address: ', '');
                        if (id?.includes('phone')) d.phone = label.replace('Phone: ', '');
                        if (id?.includes('authority')) {
                            const a = btn.querySelector('a');
                            if (a) d.website = a.href;
                        }
                    });
                    return d;
                });

                detailedResults.push({ ...lead, ...info });
            } catch (err) {
                console.log(`Fallback for ${lead.name}`);
                detailedResults.push(lead);
            }
        }

        onProgress({ status: 'complete', message: `Success! Generated ${detailedResults.length} leads.`, count: detailedResults.length });
        return detailedResults;
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
