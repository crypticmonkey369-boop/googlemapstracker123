/**
 * Validates and cleans scraped business data.
 */

/**
 * Remove duplicate businesses based on name + address combination.
 * @param {Array} businesses - Array of business objects
 * @returns {Array} Deduplicated array
 */
function removeDuplicates(businesses) {
    const seen = new Set();
    return businesses.filter((biz) => {
        const key = `${(biz.name || '').toLowerCase().trim()}|${(biz.address || '').toLowerCase().trim()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Skip entries that are missing critical fields (name or address).
 * @param {Array} businesses
 * @returns {Array}
 */
function removeIncomplete(businesses) {
    return businesses.filter((biz) => {
        return biz.name && biz.name.trim().length > 0 && biz.address && biz.address.trim().length > 0;
    });
}

/**
 * Normalize phone numbers:
 * - Remove extra whitespace
 * - Remove non-phone characters
 * - Ensure consistent formatting
 * @param {string} phone
 * @returns {string}
 */
function normalizePhone(phone) {
    if (!phone) return '';
    // Remove leading/trailing whitespace
    let cleaned = phone.trim();
    // Remove any non-digit, non-+, non-( non-) non-- characters
    cleaned = cleaned.replace(/[^\d+\-() ]/g, '');
    // Collapse multiple spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}

/**
 * Normalize URLs:
 * - Add https:// if missing
 * - Remove trailing slashes
 * - Trim whitespace
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
    if (!url) return '';
    let cleaned = url.trim();
    if (cleaned && !cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
        cleaned = 'https://' + cleaned;
    }
    // Remove trailing slash
    cleaned = cleaned.replace(/\/+$/, '');
    return cleaned;
}

/**
 * Normalize email addresses:
 * - Lowercase
 * - Trim whitespace
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
    if (!email) return '';
    return email.trim().toLowerCase();
}

/**
 * Generates a custom ice breaker message for a business.
 * @param {Object} biz - Business object
 * @returns {string} Attractive ice breaker message
 */
function generateIceBreaker(biz) {
    const name = biz.name || 'there';
    const hasWebsite = !!biz.website;
    const rating = parseFloat(biz.rating);
    const reviews = parseInt(biz.reviews, 10);

    let message = `Hey ${name}, I just went through your Google Business Profile while researching ${biz.category || 'businesses'} in your area. `;

    // Custom points based on profile status
    if (rating && rating >= 4.5 && reviews > 20) {
        message += `You have a fantastic reputation with a ${rating}-star rating and ${reviews} reviews! That's impressive and shows you provide great service. `;
    } else if (rating && rating < 4.0) {
        message += `I noticed your current rating is ${rating} stars. Often, this can be improved just by better managing your profile and responding to customers, which directly boosts your ranking. `;
    } else if (reviews && reviews < 10) {
        message += `I noticed you only have ${reviews} reviews so far. Getting a few more positive reviews could really help you jump ahead of the local competition. `;
    } else {
        message += `Your profile looks solid, and you've clearly put work into your local presence. `;
    }

    if (hasWebsite) {
        message += `You've got a good foundation with your current website, but I noticed some specific opportunities to optimize it further so you can outrank competitors and capture more of that local traffic. `;
    } else {
        message += `However, I noticed you don't have a website linked to your profile yet. Since Google uses website quality and relevance as a top ranking factor, adding a fast, mobile-optimized site would be a game-changer for your visibility. `;
    }

    message += `I specialize in helping ${biz.category || 'businesses'} like yours dominate local search by building high-performance websites and fully optimizing Google Business Profiles. Would you be open to a quick chat (or even just an email) about how we can get you to the top of the map pack?`;

    return message;
}

/**
 * Full validation pipeline.
 * @param {Array} businesses - Raw scraped data
 * @returns {Array} Cleaned and validated data
 */
function validateAndClean(businesses) {
    let data = [...businesses];

    // Step 1: Remove incomplete entries
    data = removeIncomplete(data);

    // Step 2: Normalize fields
    data = data.map((biz) => {
        const cleanedBiz = {
            category: (biz.category || '').trim(),
            name: (biz.name || '').trim(),
            address: (biz.address || '').trim(),
            phone: normalizePhone(biz.phone),
            email: normalizeEmail(biz.email),
            website: normalizeUrl(biz.website),
            rating: biz.rating || '',
            reviews: biz.reviews || '',
        };
        // Add ice breaker based on cleaned data
        cleanedBiz.iceBreaker = generateIceBreaker(cleanedBiz);
        return cleanedBiz;
    });

    // Step 3: Remove duplicates
    data = removeDuplicates(data);

    return data;
}

module.exports = { validateAndClean, removeDuplicates, removeIncomplete, normalizePhone, normalizeUrl, normalizeEmail };
