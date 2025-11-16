const fs = require('fs');
const path = require('path');
const os = require('os');
const pdf = require('pdf-parse'); // For text extraction and labeling
const { Poppler } = require('pdf-poppler'); // For image extraction
const _ = require('lodash'); // For array manipulation

// --- Configuration for Pattern Matching ---
// Regex to find artifact IDs like "YYYY.NN.MM [Description]".
const ARTIFACT_ID_REGEX = /(\d{4}\.\d{1,3}\.\d{1,3}[a-z]?[-\w]*(?:\s[\w\s,]+)?)/g;

/**
 * Extracts artifact labels using pdf-parse and physical images using pdf-poppler.
 * @param {string} pdfFilePath Path to the PDF file.
 * @returns {Promise<{imagesWithLabels: Array<{name: string, dataUrl: string}>, tempDirectory: string}>} 
 */
async function extractImagesAndLabels(pdfFilePath) {
    if (!fs.existsSync(pdfFilePath)) {
        throw new Error(`File not found: ${pdfFilePath}.`);
    }

    const tempDir = path.join(os.tmpdir(), `pdf-extract-${Date.now()}`);
    fs.mkdirSync(tempDir);

    // --- STEP 1: Extract Labels (Text) ---
    const dataBuffer = fs.readFileSync(pdfFilePath);
    const data = await pdf(dataBuffer);
    const pdfText = data.text;
    
    let foundLabels = [];
    let match;

    // Use Regex to find all artifact labels in the PDF text
    while ((match = ARTIFACT_ID_REGEX.exec(pdfText)) !== null) {
        const label = match[0].trim();
        // Prevent duplicate labels (as they may appear on multiple pages/sections)
        if (!foundLabels.includes(label)) {
            foundLabels.push(label);
        }
    }

    // --- STEP 2: Extract Images (Physical Files) ---
    const poppler = new Poppler();
    const options = {
        firstPage: 1,
        lastPage: data.numpages, // Process all pages
        png: true, // Extract as PNG for quality
        singleFile: false, // Ensure we get individual image files
        out_prefix: 'img_'
    };

    // pdf-poppler creates a set of images (e.g., img_1-0.png, img_1-1.png, etc.) 
    // in the temporary directory.
    await poppler.pdfToCairo(pdfFilePath, tempDir, options);

    // --- STEP 3: Match Labels to Images ---
    
    // Get all extracted image files
    // Use natural sorting (via Lodash/localeCompare) to order files correctly: img_1-1 before img_1-10
    const extractedFiles = fs.readdirSync(tempDir)
        .filter(file => file.endsWith('.png'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    let results = [];

    // We assume the sequence of extracted images matches the sequence of found labels.
    const numberOfItemsToProcess = Math.min(foundLabels.length, extractedFiles.length);

    for (let i = 0; i < numberOfItemsToProcess; i++) {
        const label = foundLabels[i];
        const tempFileName = extractedFiles[i];
        const tempFilePath = path.join(tempDir, tempFileName);

        // Read the actual image file
        const imageBuffer = fs.readFileSync(tempFilePath);
        const base64Data = imageBuffer.toString('base64');

        results.push({
            name: `${label}.png`,
            // Use the actual Base64 data URL for the display in the UI
            dataUrl: `data:image/png;base64,${base64Data}`
        });
    }

    if (results.length === 0 && foundLabels.length > 0) {
        throw new Error("Labeling succeeded, but no matching images were extracted. Check Poppler installation or PDF content.");
    }
    
    console.log(`[Dual-Engine] Final matched results: ${results.length}`);
    return { 
        imagesWithLabels: results, 
        tempDirectory: tempDir 
    };
}

module.exports = {
    extractImagesAndLabels
};