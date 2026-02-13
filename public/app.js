/**
 * LeadScraper — Frontend Application Logic
 * Handles form submission, progress polling, results display, and file download.
 */

(function () {
    'use strict';

    // DOM Elements
    const scraperCard = document.getElementById('scraper-card');
    const progressCard = document.getElementById('progress-card');
    const resultsCard = document.getElementById('results-card');
    const errorCard = document.getElementById('error-card');

    const scrapeForm = document.getElementById('scrape-form');
    const submitBtn = document.getElementById('submit-btn');
    const downloadBtn = document.getElementById('download-btn');
    const newScrapeBtn = document.getElementById('new-scrape-btn');
    const retryBtn = document.getElementById('retry-btn');

    const progressTitle = document.getElementById('progress-title');
    const progressMessage = document.getElementById('progress-message');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressPercent = document.getElementById('progress-percent');
    const detailStatus = document.getElementById('detail-status');
    const detailCount = document.getElementById('detail-count');

    const resultsTitle = document.getElementById('results-title');
    const resultsSubtitle = document.getElementById('results-subtitle');
    const resultsTbody = document.getElementById('results-tbody');
    const errorMessage = document.getElementById('error-message');

    let currentJobId = null;
    let pollInterval = null;

    // ===================================
    // NAVBAR SCROLL EFFECT
    // ===================================
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 20) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // ===================================
    // FORM SUBMISSION
    // ===================================
    scrapeForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const category = document.getElementById('category').value.trim();
        const state = document.getElementById('state').value.trim();
        const country = document.getElementById('country').value.trim();
        let leads = parseInt(document.getElementById('leads').value, 10);

        if (!category || !state || !country) {
            shakeButton(submitBtn);
            return;
        }

        // Clamp leads between 1 and 100
        if (isNaN(leads) || leads < 1) leads = 1;
        if (leads > 100) leads = 100;

        // Disable form
        submitBtn.disabled = true;
        submitBtn.querySelector('span').textContent = 'Starting...';

        try {
            const response = await fetch('/api/scrape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category, state, country, leads }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to start scraping');
            }

            currentJobId = data.jobId;

            // Show progress card
            showCard('progress');
            startPolling();
        } catch (err) {
            showError(err.message);
        }
    });

    // ===================================
    // POLLING
    // ===================================
    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);

        pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/status/${currentJobId}`);
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to get status');
                }

                updateProgress(data);

                if (data.status === 'complete') {
                    clearInterval(pollInterval);
                    pollInterval = null;
                    setTimeout(() => showResults(data), 800);
                } else if (data.status === 'error') {
                    clearInterval(pollInterval);
                    pollInterval = null;
                    showError(data.error || 'An unknown error occurred');
                }
            } catch (err) {
                clearInterval(pollInterval);
                pollInterval = null;
                showError(err.message);
            }
        }, 1500);
    }

    function updateProgress(data) {
        progressMessage.textContent = data.message || 'Working...';
        progressBarFill.style.width = `${data.progress || 0}%`;
        progressPercent.textContent = `${data.progress || 0}%`;
        detailStatus.textContent = capitalize(data.status || 'Working');
        detailCount.textContent = data.resultCount || '0';
    }

    // ===================================
    // SHOW RESULTS
    // ===================================
    function showResults(data) {
        resultsTitle.textContent = 'Scraping Complete!';
        resultsSubtitle.textContent = `Found ${data.resultCount} verified business leads`;

        // Populate table
        resultsTbody.innerHTML = '';
        const results = data.results || [];

        if (results.length === 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="5" style="text-align:center; color:var(--gray-400); padding: 2rem;">No results to preview</td>`;
            resultsTbody.appendChild(tr);
        } else {
            results.forEach((biz, i) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
          <td>${i + 1}</td>
          <td title="${escapeHtml(biz.name)}">${escapeHtml(biz.name)}</td>
          <td title="${escapeHtml(biz.address)}">${escapeHtml(biz.address)}</td>
          <td>${escapeHtml(biz.phone) || '—'}</td>
          <td>${biz.website ? `<a href="${escapeHtml(biz.website)}" target="_blank" style="color:var(--primary-600)">${truncate(biz.website, 30)}</a>` : '—'}</td>
        `;
                resultsTbody.appendChild(tr);
            });
        }

        showCard('results');
    }

    // ===================================
    // DOWNLOAD
    // ===================================
    downloadBtn.addEventListener('click', () => {
        if (!currentJobId) return;
        window.location.href = `/api/download/${currentJobId}`;
    });

    // ===================================
    // NEW SCRAPE
    // ===================================
    newScrapeBtn.addEventListener('click', resetToForm);
    retryBtn.addEventListener('click', resetToForm);

    function resetToForm() {
        currentJobId = null;
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }

        // Reset form
        scrapeForm.reset();
        submitBtn.disabled = false;
        submitBtn.querySelector('span').textContent = 'Start Scraping';

        // Reset progress
        progressBarFill.style.width = '0%';
        progressPercent.textContent = '0%';
        detailStatus.textContent = 'Starting...';
        detailCount.textContent = '0';

        // Show form
        showCard('form');
    }

    // ===================================
    // CARD VISIBILITY
    // ===================================
    function showCard(which) {
        scraperCard.classList.toggle('hidden', which !== 'form');
        progressCard.classList.toggle('hidden', which !== 'progress');
        resultsCard.classList.toggle('hidden', which !== 'results');
        errorCard.classList.toggle('hidden', which !== 'error');

        // Scroll to scraper section
        const section = document.getElementById('scraper');
        if (section) {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function showError(msg) {
        errorMessage.textContent = msg;
        showCard('error');
    }

    // ===================================
    // UTILITIES
    // ===================================
    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function truncate(str, max) {
        if (!str) return '';
        return str.length > max ? str.substring(0, max) + '...' : str;
    }

    function shakeButton(btn) {
        btn.style.animation = 'shake 0.4s ease';
        setTimeout(() => (btn.style.animation = ''), 400);
    }

    // Add shake keyframes dynamically
    const style = document.createElement('style');
    style.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-6px); }
      75% { transform: translateX(6px); }
    }
  `;
    document.head.appendChild(style);
})();
