const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { scrapeGoogleMaps } = require('./scraper');
const { validateAndClean } = require('./validator');
const { generateExcel } = require('./excelGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory job store
const jobs = new Map();

/**
 * POST /api/scrape
 * Start a scraping job
 */
app.post('/api/scrape', (req, res) => {
    const { category, state, country, leads } = req.body;

    if (!category || !state || !country) {
        return res.status(400).json({
            error: 'Missing required fields: category, state, country',
        });
    }

    // Clamp leads between 1 and 100
    const maxLeads = Math.min(Math.max(parseInt(leads, 10) || 20, 1), 100);

    const jobId = uuidv4();
    const job = {
        id: jobId,
        category,
        state,
        country,
        maxLeads,
        status: 'starting',
        progress: 0,
        message: 'Initializing scraper...',
        resultCount: 0,
        results: [],
        filePath: null,
        error: null,
        createdAt: new Date().toISOString(),
    };

    jobs.set(jobId, job);

    // Start scraping asynchronously
    runScrapeJob(job);

    res.json({ jobId, status: 'started' });
});

/**
 * GET /api/status/:jobId
 * Get the status of a scraping job
 */
app.get('/api/status/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
        id: job.id,
        status: job.status,
        progress: job.progress,
        message: job.message,
        resultCount: job.resultCount,
        results: job.status === 'complete' ? job.results.slice(0, 20) : [], // Preview first 20
        error: job.error,
    });
});

/**
 * GET /api/download/:jobId
 * Download the generated Excel file
 */
app.get('/api/download/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'complete' || !job.filePath) {
        return res.status(400).json({ error: 'File not ready yet' });
    }

    const filename = `leads_${job.category.replace(/\s+/g, '_')}_${job.state.replace(/\s+/g, '_')}.xlsx`;
    res.download(job.filePath, filename);
});

/**
 * Runs the scraping job asynchronously.
 */
async function runScrapeJob(job) {
    try {
        job.status = 'scraping';
        job.message = 'Starting Google Maps scraper...';

        const rawResults = await scrapeGoogleMaps(
            job.category,
            job.state,
            job.country,
            job.maxLeads,
            (progress) => {
                job.message = progress.message || job.message;
                if (progress.total && progress.current) {
                    job.progress = Math.round((progress.current / progress.total) * 100);
                }
                if (progress.count) {
                    job.resultCount = progress.count;
                }
            }
        );

        // Validate and clean
        job.status = 'validating';
        job.message = 'Validating and cleaning data...';
        job.progress = 90;

        const cleanedResults = validateAndClean(rawResults);
        job.results = cleanedResults;
        job.resultCount = cleanedResults.length;

        // Generate Excel
        job.status = 'generating';
        job.message = 'Generating Excel file...';
        job.progress = 95;

        const outputDir = path.join(__dirname, 'output');
        const outputPath = path.join(outputDir, `${job.id}.xlsx`);
        await generateExcel(cleanedResults, outputPath);
        job.filePath = outputPath;

        // Done
        job.status = 'complete';
        job.progress = 100;
        job.message = `Successfully scraped ${cleanedResults.length} businesses!`;

        console.log(`Job ${job.id} complete: ${cleanedResults.length} results`);
    } catch (error) {
        job.status = 'error';
        job.error = error.message;
        job.message = `Error: ${error.message}`;
        console.error(`Job ${job.id} failed:`, error.message);
    }
}

// Cleanup old jobs every 30 minutes
setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs) {
        if (now - new Date(job.createdAt).getTime() > 3600000) {
            jobs.delete(id);
        }
    }
}, 1800000);

app.listen(PORT, () => {
    console.log(`\n🚀 Google Maps Lead Scraper running at http://localhost:${PORT}\n`);
});
