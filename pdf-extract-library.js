const fs = require('fs');
const path = require('path');
const os = require('os');
const pdf = require('pdf-parse'); 
// --- CRITICAL FIX: Direct import ensures the Poppler constructor is correctly received.
const Poppler = require('node-poppler'); 
const _ = require('lodash'); 

// --- CRITICAL: Hardcoded Poppler Path ---
// This is the specific location where the Poppler executables (pdftocairo.exe, etc.) reside.
const POPPLER_PATH = "C:\\Program Files\\poppler-25.08.0\\poppler-25.08.0\\bin"; 

// Regex for finding accession numbers (YYYY.NN.MM...)
const ARTIFACT_ID_REGEX = /(\d{4}\.\d{1,3}\.\d{1,3}[a-z]?[-\w]*(?:\s[\w\s,]+)?)/g;

/**
 * Executes dual extraction: pdf-parse for text labels, node-poppler for images.
 * @param {string} pdfFilePath Path to the PDF file.
 * @returns {Promise<{imagesWithLabels: Array<{name: string, dataUrl: string}>, tempDirectory: string}>} 
 */
async function extractImagesAndLabels(pdfFilePath) {
    if (!fs.existsSync(pdfFilePath)) {
        throw new Error(`PDF not found: ${pdfFilePath}.`);
    }

    const tempDir = path.join(os.tmpdir(), `pdf-extract-${Date.now()}`);
    fs.mkdirSync(tempDir);

    // Initialize Poppler with the hardcoded path.
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

    // This command executes the pdftocairo.exe located at POPPLER_PATH.
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
```

---

## Your Next Steps: Launch the Application 🚀

Since all modules are now installed and the code syntax is fixed, your app should finally launch correctly.

1.  **Open VS Code Terminal.**
2.  **Run the Application:**
    ```bash
    npm start