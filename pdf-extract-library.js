const fs = require('fs');
const path = require('path');
const os = require('os');
const pdf = require('pdf-parse'); 
// CRITICAL FIX: The wrapper constructor is imported directly from the package, not via destructuring.
const { Poppler } = require('node-poppler'); 
const _ = require('lodash'); 

// --- Configuration for Pattern Matching ---
const ARTIFACT_ID_REGEX = /(\d{4}\.\d{1,3}\.\d{1,3}[a-z]?[-\w]*(?:\s[\w\s,]+)?)/g;

// --- CRITICAL: Poppler Executable Path Configuration ---
// Setting the path to 'null' forces node-poppler to use system PATH,
// which is needed if installed via Chocolatey.
const POPPLER_PATH = null; 

/**
 * Extracts artifact labels using pdf-parse and physical images using node-poppler.
 * @param {string} pdfFilePath Path to the PDF file.
 * @returns {Promise<{imagesWithLabels: Array<{name: string, dataUrl: string}>, tempDirectory: string}>} 
 */
async function extractImagesAndLabels(pdfFilePath) {
    if (!fs.existsSync(pdfFilePath)) {
        throw new Error(`File not found: ${pdfFilePath}.`);
    }

    const tempDir = path.join(os.tmpdir(), `pdf-extract-${Date.now()}`);
    fs.mkdirSync(tempDir);

    // Initialize Poppler, relying on system PATH
    // The previous error was a constructor issue; this line uses the corrected syntax 
    // based on how node-poppler exports its main class.
    const poppler = new Poppler(POPPLER_PATH);
    
    // --- STEP 1: Extract Labels (Text) ---
    const dataBuffer = fs.readFileSync(pdfFilePath);
    const data = await pdf(dataBuffer);
    const pdfText = data.text;
    
    let foundLabels = [];
    let match;

    while ((match = ARTIFACT_ID_REGEX.exec(pdfText)) !== null) {
        const label = match[0].trim();
        if (!foundLabels.includes(label)) {
            foundLabels.push(label);
        }
    }

    // --- STEP 2: Extract Images (Physical Files via Poppler) ---
    const options = {
        firstPage: 1,
        lastPage: data.numpages,
        png: true, 
        singleFile: false, 
        outPrefix: path.join(tempDir, 'img_')
    };

    // This command requires pdftocairo.exe to be available globally on your system.
    await poppler.pdfToCairo(pdfFilePath, options);

    // --- STEP 3: Match Labels to Images ---
    
    const extractedFiles = fs.readdirSync(tempDir)
        .filter(file => file.endsWith('.png'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    let results = [];
    const numberOfItemsToProcess = Math.min(foundLabels.length, extractedFiles.length);

    for (let i = 0; i < numberOfItemsToProcess; i++) {
        const label = foundLabels[i];
        const tempFileName = extractedFiles[i];
        const tempFilePath = path.join(tempDir, tempFileName);

        // Read the actual image file and convert to Base64 for UI display and saving
        const imageBuffer = fs.readFileSync(tempFilePath);
        const base64Data = imageBuffer.toString('base64');

        results.push({
            name: `${label}.png`,
            dataUrl: `data:image/png;base64,${base64Data}`
        });
    }
    
    return { 
        imagesWithLabels: results, 
        tempDirectory: tempDir 
    };
}

module.exports = {
    extractImagesAndLabels
};