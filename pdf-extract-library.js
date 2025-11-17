const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process'); // For stable CLI call
const pdf = require('pdf-parse'); 
const _ = require('lodash'); 

// --- CRITICAL FIX: HARDCODED POPPLER PATH ---
// Path pointing to the folder containing pdftocairo.exe, now 100% verified.
const POPPLER_BIN_PATH = "C:\\Program Files\\Release-24.08.0-0\\poppler-24.08.0\\Library\\bin";

// Regex for finding accession numbers (YYYY.NN.MM...)
const ARTIFACT_ID_REGEX = /(\d{4}\.\d{1,3}\.\d{1,3}[a-z]?[-\w]*(?:\s[\w\s,]+)?)/g;

/**
 * Executes the core Poppler command-line interface directly via Node.js exec.
 * This handles paths with spaces robustly by quoting the executable path.
 * @param {string} pdfFilePath Path to the PDF file.
 * @param {string} tempDir Directory for image output.
 * @param {number} totalPages Total pages to process.
 * @returns {Promise<void>} Resolves when CLI finishes.
 */
function runPdftocairoCli(pdfFilePath, tempDir, totalPages) {
    return new Promise((resolve, reject) => {
        const exePath = path.join(POPPLER_BIN_PATH, 'pdftocairo.exe');
        
        // 1. Quoting the executable path and the PDF file path (as it may also contain spaces)
        const quotedExePath = `"${exePath}"`;
        const quotedPdfPath = `"${pdfFilePath}"`;
        
        // 2. Building the full command string for the shell (using exec is best here)
        const outputPrefix = path.join(tempDir, 'img_');

        const command = [
            quotedExePath, // This is the program to run, correctly quoted
            '-png', 
            '-f', '1', 
            '-l', String(totalPages),
            quotedPdfPath,
            outputPrefix
        ].join(' ');
        
        // 3. Execute the command string
        child_process.exec(command, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
            if (error || stderr.length > 0) {
                const errorOutput = stderr ? stderr.toString() : (error ? error.message : "Unknown error.");
                reject(new new Error(`Failed to execute Poppler CLI. Details: ${errorOutput}`));
            } else {
                resolve();
            }
        });
    });
}

/**
 * Executes dual extraction: pdf-parse for text labels, direct CLI for images.
 * @param {string} pdfFilePath Path to the PDF file.
 * @returns {Promise<{imagesWithLabels: Array<{name: string, dataUrl: string}>, tempDirectory: string}>} 
 */
async function extractImagesAndLabels(pdfFilePath) {
    if (!fs.existsSync(pdfFilePath)) {
        throw new Error(`PDF not found: ${pdfFilePath}.`);
    }

    const tempDir = path.join(os.tmpdir(), `pdf-extract-${Date.now()}`);
    fs.mkdirSync(tempDir);
    
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

    // --- STEP 2: Extract Images (Physical Files via Direct CLI) ---
    await runPdftocairoCli(pdfFilePath, tempDir, data.numpages);

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