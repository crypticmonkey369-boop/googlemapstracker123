const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Main Scraper Function - Optimized for Cloud IPs (Render/Heroku)
 */
async function scrapeGoogleMaps(category, state, country, maxLeads = 20, onProgress = () => { }) {
    const MAX_LEADS = Math.min(Math.max(parseInt(maxLeads, 10) || 20, 1), 100);
    // Construct search query
    const query = `${category} in ${state} ${country}`;

    // FAILSAFE 1: Use the "Local Search" URL instead of full Maps UI
    // This is much lighter and harder for Google to block/cloak on cloud IPs
    const searchUrl = `https://www.google.com/search?tbm=lcl&q=${encodeURIComponent(query)}&hl=en`;

    let browser;
    try {
        onProgress({ status: 'launching', message: 'Starting Stealth Engine...' });

        browser = await puppeteer.launch({
            headless: true,
            timeout: 90000,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1920,1080',
                '--lang=en-US,en;q=0.9',
            ],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        onProgress({ status: 'navigating', message: `Contacting Google for "${category}"...` });

        // Use a patient navigation
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await delay(4000);

        // --- PHASE 1: BYPASS CONSENT / LOCATION BLOCKS ---
        try {
            // Wait for one of the common consent/cookie buttons
            const consentSelectors = [
                'button[aria-label="Accept all"]',
                'button[aria-label="Accept everything"]',
                '#L2AGLb', // Direct ID for "I agree"
                'form[action*="consent"] button'
            ];

            for (const sel of consentSelectors) {
                const btn = await page.$(sel);
                if (btn) {
                    await btn.click();
                    await delay(3000);
                    break;
                }
            }
        } catch (e) {
            console.log("Consent stage clear.");
        }

        let collectedLeads = [];
        let previousCount = 0;
        let stagnating = 0;

        onProgress({ status: 'scrolling', message: 'Scanning live results...' });

        // --- PHASE 2: COLLECTION ---
        // We scan and scroll multiple times to ensure we get a full list
        for (let i = 0; i < 15; i++) {
            const data = await page.evaluate((cat) => {
                const items = [];
                // Selector for Local search list items
                const cards = document.querySelectorAll('div[role="article"], .Vkp9Ed, .C8077e, a[href*="/maps/place/"]');

                cards.forEach(card => {
                    // Find name
                    const nameEl = card.querySelector('div.uOaeOf, h3, .qBF1Pd, .fontHeadlineSmall');
                    const linkEl = card.querySelector('a[href*="/maps/place/"]') || card;
                    const url = linkEl.href || '';
                    const name = nameEl ? nameEl.textContent.trim() : card.getAttribute('aria-label') || '';

                    if (name && url.includes('/maps/place/') && !items.find(x => x.url === url)) {
                        // Extract basic stats visible in the list
                        const details = Array.from(card.querySelectorAll('div, span')).map(e => e.textContent.trim());

                        items.push({
                            category: cat,
                            name: name,
                            url: url,
                            address: '',
                            rating: card.querySelector('.MW4etd, .Y0A1S')?.textContent || '',
                            reviews: card.querySelector('.UY7F9, .R9Z9Sp')?.textContent?.replace(/[^0-9]/g, '') || '',
                            phone: '',
                            website: ''
                        });
                    }
                });
                return items;
            }, category);

            // Add unique ones to our main list
            data.forEach(item => {
                if (!collectedLeads.find(r => r.url === item.url)) {
                    collectedLeads.push(item);
                }
            });

            onProgress({
                status: 'scrolling',
                message: `Found ${collectedLeads.length} businesses...`,
                count: collectedLeads.length
            });

            if (collectedLeads.length >= MAX_LEADS) break;

            if (collectedLeads.length === previousCount) {
                stagnating++;
                if (stagnating >= 3) break;
            } else {
                stagnating = 0;
            }
            previousCount = collectedLeads.length;

            // Scroll the container
            await page.evaluate(() => window.scrollBy(0, 1000));
            await delay(2000);
        }

        // --- FAILSAFE 2: FALLBACK TO FULL MAPS ---
        if (collectedLeads.length === 0) {
            onProgress({ status: 'retrying', message: 'Retrying with global map view...' });
            const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
            await page.goto(mapsUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            await delay(5000);

            // Re-run collection on the Map layout
            const mapData = await page.evaluate((cat) => {
                const items = [];
                document.querySelectorAll('a[href*="/maps/place/"]').forEach(a => {
                    const name = a.getAttribute('aria-label') || '';
                    if (name && !items.find(x => x.url === a.href)) {
                        items.push({
                            category: cat,
                            name: name,
                            url: a.href,
                            address: '',
                            rating: '',
                            reviews: '',
                            phone: '',
                            website: ''
                        });
                    }
                });
                return items;
            }, category);

            mapData.forEach(item => {
                if (!collectedLeads.find(r => r.url === item.url)) collectedLeads.push(item);
            });
        }

        if (collectedLeads.length === 0) {
            throw new Error("Google is blocking access or returned 0 results. Try a simpler search like 'Bakeries Kerala'.");
        }

        const finalLeads = collectedLeads.slice(0, MAX_LEADS);
        onProgress({ status: 'extracting', message: `Updating details for ${finalLeads.length} leads...`, total: finalLeads.length });

        // --- PHASE 3: ENRICHMENT ---
        const detailedResults = [];
        for (let i = 0; i < finalLeads.length; i++) {
            const lead = finalLeads[i];
            try {
                onProgress({
                    status: 'extracting',
                    message: `Opening profile ${i + 1}/${finalLeads.length}: ${lead.name}`,
                    current: i + 1,
                    total: finalLeads.length
                });

                await page.goto(lead.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await delay(2500);

                const info = await page.evaluate(() => {
                    const d = { address: '', phone: '', website: '', rating: '', reviews: '' };

                    // Rating/Reviews
                    const r = document.querySelector('span[role="img"][aria-label*="stars"]');
                    if (r) d.rating = r.getAttribute('aria-label').split(' ')[0];
                    const rev = document.querySelector('button[aria-label*="reviews"]');
                    if (rev) d.reviews = rev.getAttribute('aria-label').replace(/[^0-9]/g, '');

                    // Detail Search
                    document.querySelectorAll('button[data-item-id], a[data-item-id]').forEach(el => {
                        const id = el.getAttribute('data-item-id');
                        const label = el.getAttribute('aria-label') || '';
                        if (id?.includes('address')) d.address = label.replace('Address: ', '');
                        if (id?.includes('phone')) d.phone = label.replace('Phone: ', '');
                        if (id?.includes('authority')) {
                            if (el.tagName === 'A') d.website = el.href;
                            else {
                                const a = el.querySelector('a');
                                if (a) d.website = a.href;
                            }
                        }
                    });
                    return d;
                });

                detailedResults.push({ ...lead, ...info });
            } catch (err) {
                console.log(`Using partial info for ${lead.name}`);
                detailedResults.push(lead);
            }
        }

        onProgress({ status: 'complete', message: `Successfully scraped ${detailedResults.length} businesses!`, count: detailedResults.length });
        return detailedResults;

    } catch (error) {
        console.error('ULTIMATE SCRAPE FAILED:', error.message);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { scrapeGoogleMaps };
