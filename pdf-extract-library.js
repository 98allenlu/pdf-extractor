const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process'); // For direct CLI call
const pdf = require('pdf-parse'); 
const _ = require('lodash'); 

// --- CRITICAL FIX: HARDCODED POPPLER PATH ---
// This path is now 100% correct and points directly to the folder containing pdftocairo.exe.
const POPPLER_BIN_PATH = "C:\\Program Files\\Release-24.08.0-0\\poppler-24.08.0\\Library\\bin";

// Regex for finding accession numbers (YYYY.NN.MM...)
const ARTIFACT_ID_REGEX = /(\d{4}\.\d{1,3}\.\d{1,3}[a-z]?[-\w]*(?:\s[\w\s,]+)?)/g;

/**
 * Executes the core Poppler command-line interface directly via Node.js spawn.
 * This is the most stable method and bypasses Node.js wrapper constructor issues.
 * @param {string} pdfFilePath Path to the PDF file.
 * @param {string} tempDir Directory for image output.
 * @param {number} totalPages Total pages to process.
 * @returns {Promise<void>} Resolves when CLI finishes.
 */
function runPdftocairoCli(pdfFilePath, tempDir, totalPages) {
    return new Promise((resolve, reject) => {
        // Build the full path to the executable
        const exePath = path.join(POPPLER_BIN_PATH, 'pdftocairo.exe');
        
        // Command Arguments: -png (format), -f 1 (first page), -l [last page], input path, output prefix
        const args = [
            '-png', 
            '-f', '1', 
            '-l', String(totalPages),
            pdfFilePath,
            path.join(tempDir, 'img_')
        ];
        
        // Spawn the process
        const proc = child_process.spawn(exePath, args, { shell: true });
        
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        
        proc.on('error', (err) => {
            // This error confirms the executable is missing.
            reject(new Error(`Failed to execute Poppler. Check that the file 'pdftocairo.exe' is inside the folder: ${POPPLER_BIN_PATH}. Error: ${err.message}`));
        });
        
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`pdftocairo exited with code ${code}. Stderr: ${stderr}`));
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