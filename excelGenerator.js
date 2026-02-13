const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

/**
 * Generate a beautifully formatted Excel file from validated business data.
 * Each unique category gets its own sheet with styling.
 *
 * @param {Array} businesses - Array of validated business objects
 * @param {string} outputPath - Full path for the output .xlsx file
 * @returns {Promise<string>} Path to the generated file
 */
async function generateExcel(businesses, outputPath) {
    // Ensure output directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LeadScraper';
    workbook.lastModifiedBy = 'LeadScraper';
    workbook.created = new Date();
    workbook.modified = new Date();

    // Group businesses by category
    const categories = {};
    businesses.forEach((biz) => {
        const cat = (biz.category || 'General').trim();
        if (!categories[cat]) {
            categories[cat] = [];
        }
        categories[cat].push(biz);
    });

    // If no data, create a placeholder structure
    if (Object.keys(categories).length === 0) {
        categories['No Results'] = [];
    }

    // Create a sheet for each category
    for (const [categoryName, categoryData] of Object.entries(categories)) {
        // Sanitize sheet name (max 31 chars, no special characters)
        let sheetName = categoryName.replace(/[\\/*?[\]:]/g, '').substring(0, 31);
        if (!sheetName) sheetName = 'Sheet1';

        const worksheet = workbook.addWorksheet(sheetName, {
            views: [{ state: 'frozen', ySplit: 1 }] // Freeze header row
        });

        // Define columns
        worksheet.columns = [
            { header: 'Category', key: 'category', width: 20 },
            { header: 'Business Name', key: 'name', width: 35 },
            { header: 'Full Address', key: 'address', width: 50 },
            { header: 'Phone Number', key: 'phone', width: 20 },
            { header: 'Email ID', key: 'email', width: 30 },
            { header: 'Website Present', key: 'websitePresent', width: 15 },
            { header: 'Website URL', key: 'website', width: 40 },
            { header: 'Ice Breaker', key: 'iceBreaker', width: 80 }
        ];

        // Format header row
        const headerRow = worksheet.getRow(1);
        headerRow.font = { name: 'Arial', family: 4, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2563EB' } // Primary Blue from our UI
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 25;

        // Add dynamic rows
        if (categoryData.length > 0) {
            categoryData.forEach((biz) => {
                const row = worksheet.addRow({
                    category: biz.category || '',
                    name: biz.name || '',
                    address: biz.address || '',
                    phone: biz.phone || '',
                    email: biz.email || '',
                    websitePresent: biz.website ? 'Yes' : 'No',
                    website: biz.website || '',
                    iceBreaker: biz.iceBreaker || ''
                });

                // Apply cell styling to data rows
                row.alignment = { vertical: 'middle', wrapText: true };

                // Highlight Yes/No
                const presenceCell = row.getCell('websitePresent');
                presenceCell.alignment = { horizontal: 'center', vertical: 'middle' };
                if (biz.website) {
                    presenceCell.font = { color: { argb: 'FF059669' }, bold: true }; // Green for Yes
                } else {
                    presenceCell.font = { color: { argb: 'FFDC2626' }, bold: true }; // Red for No
                }

                // Make website look like a link
                if (biz.website) {
                    const websiteCell = row.getCell('website');
                    websiteCell.value = {
                        text: biz.website,
                        hyperlink: biz.website,
                        tooltip: biz.website
                    };
                    websiteCell.font = { color: { argb: 'FF2563EB' }, underline: true };
                }
            });
        } else {
            worksheet.addRow(['No results found', '', '', '', '', '', '', '']);
        }

        // Add borders to all active cells
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFDEE2E6' } },
                    left: { style: 'thin', color: { argb: 'FFDEE2E6' } },
                    bottom: { style: 'thin', color: { argb: 'FFDEE2E6' } },
                    right: { style: 'thin', color: { argb: 'FFDEE2E6' } }
                };
            });
        });
    }

    // Write to file
    await workbook.xlsx.writeFile(outputPath);

    return outputPath;
}

module.exports = { generateExcel };
