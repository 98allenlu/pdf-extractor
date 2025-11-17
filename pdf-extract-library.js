const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process'); // For stable CLI call
const pdf = require('pdf-parse'); // For generalized text regex matching
const _ = require('lodash'); 

// --- CRITICAL FIX: HARDCODED POPPLER PATH ---
// This path is now 100% correct and points directly to the folder containing pdftocairo.exe.
const POPPLER_BIN_PATH = "C:\\Program Files\\Release-24.08.0-0\\poppler-24.08.0\\Library\\bin";

// Regex for finding accession numbers (YYYY.NN.MM...)
const ARTIFACT_ID_REGEX = /(\d{4}\.\d{1,3}\.\d{1,3}[a-z]?[-\w]*(?:\s[\w\s,]+)?)/g;

/**
 * Executes the Poppler tool pdfimages.exe to extract all embedded images.
 * @param {string} pdfFilePath Path to the PDF file.
 * @param {string} tempDir Directory for image output.
 * @param {number} totalPages Total pages to process.
 * @returns {Promise<void>} Resolves when CLI finishes.
 */
function runImageExtractionCli(pdfFilePath, tempDir, totalPages) {
    return new Promise((resolve, reject) => {
        // We use pdfimages.exe for individual image extraction
        const exePath = path.join(POPPLER_BIN_PATH, 'pdfimages.exe');
        
        // 1. Quoting the executable path and the PDF file path (essential for paths with spaces)
        const quotedExePath = `"${exePath}"`;
        const quotedPdfPath = `"${pdfFilePath}"`;
        
        // 2. Build the command string for the shell using correct quotes
        const outputPrefix = path.join(tempDir, 'img-');
        
        const command = [
            quotedExePath, // Program to run, correctly quoted
            '-png', 
            '-f', '1', 
            '-l', String(totalPages),
            quotedPdfPath,
            `"${outputPrefix}"` // Output prefix is quoted for safety
        ].join(' ');
        
        // 3. Execute the command string using exec for reliable shell command handling
        child_process.exec(command, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
            if (error) {
                // If the error is due to execution failure, it will be caught here.
                reject(new Error(`PDF Image Extraction Failed. Ensure 'pdfimages.exe' is available in the configured path. Details: ${error.message}`));
            } else {
                // Resolve on success
                resolve();
            }
        });
    });
}

/**
 * Executes dual extraction: pdf-parse for text labels, pdfimages for image content.
 * @param {string} pdfFilePath Path to the PDF file.
 * @returns {Promise<{imagesWithLabels: Array<{name: string, dataUrl: string}>, tempDirectory: string}>} 
 */
async function extractImagesAndLabels(pdfFilePath) {
    if (!fs.existsSync(pdfFilePath)) {
        throw new Error(`PDF not found: ${pdfFilePath}.`);
    }

    const tempDir = path.join(os.tmpdir(), `pdf-extract-${Date.now()}`);
    fs.mkdirSync(tempDir);
    
    // --- STEP 1: Extract Labels (Text) using pdf-parse ---
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

    // --- STEP 2: Extract Images (Physical Files via pdfimages.exe) ---
    // This dumps individual embedded images to the temp folder.
    await runImageExtractionCli(pdfFilePath, tempDir, data.numpages);

    // --- STEP 3: Match Labels to Images (Best-Effort Sequential Matching) ---
    
    // The filenames from pdfimages are sequential (e.g., img-000.png, img-001.png, etc.)
    const extractedFiles = fs.readdirSync(tempDir)
        .filter(file => file.match(/img-\d+\.png$/i)) // Match files like img-000.png
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    let results = [];
    // Only match as many images as we found labels (best-effort pairing by order)
    const numberOfItemsToProcess = Math.min(foundLabels.length, extractedFiles.length);

    for (let i = 0; i < numberOfItemsToProcess; i++) {
        const label = foundLabels[i];
        const tempFileName = extractedFiles[i];
        const tempFilePath = path.join(tempDir, tempFileName);

        const imageBuffer = fs.readFileSync(tempFilePath);
        const base64Data = imageBuffer.toString('base64');

        results.push({
            name: `${label}.png`,
            dataUrl: `data:image/png;base64,${base64Data}`
        });
    }

    if (results.length === 0) {
        throw new Error("Extraction failed. Poppler found no separate embedded images in the PDF. The file may contain only page graphics.");
    }
    
    return { 
        imagesWithLabels: results, 
        tempDirectory: tempDir 
    };
}

module.exports = {
    extractImagesAndLabels
};