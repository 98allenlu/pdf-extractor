const fs = require('fs');
const path = require('path');
const os = require('os');
const PDFServicesSdk = require('@adobe/pdfservices-node-sdk');
const AdmZip = require('adm-zip'); // For unzipping the API result
const pdf = require('pdf-parse'); 

// --- CRITICAL: REPLACE THESE WITH YOUR ADOBE PDF SERVICES API CREDENTIALS ---
const CLIENT_ID = '63dd23330945473b8c946c8d0afa77d1'; // <-- YOUR ACTUAL CLIENT ID
const CLIENT_SECRET = 'YOUR_ADOBE_CLIENT_SECRET';  // <-- YOUR ACTUAL CLIENT SECRET
// ------------------------------------------------------------------

// Regex for finding accession numbers (YYYY.NN.MM...)
const ARTIFACT_ID_REGEX = /(\d{4}\.\d{1,3}\.\d{1,3}[a-z]?[-\w]*(?:\s[\w\s,]+)?)/g;

/**
 * Extracts and processes PDF files using Adobe PDF Services API, handling ZIP output.
 * @param {string} pdfFilePath Path to the local PDF file.
 * @returns {Promise<{imagesWithLabels: Array<{name: string, dataUrl: string, filePath: string}>, tempDirectory: string}>}
 */
async function extractImagesAndLabels(pdfFilePath) {
    // Simple check to ensure user updated credentials
    if (CLIENT_ID === 'YOUR_ADOBE_CLIENT_ID' || CLIENT_SECRET === 'YOUR_ADOBE_CLIENT_SECRET') {
        throw new Error("Adobe Credentials not set. Please update CLIENT_ID and CLIENT_SECRET in pdf-extract-library.js.");
    }
    if (!fs.existsSync(pdfFilePath)) {
        throw new Error(`PDF not found: ${pdfFilePath}.`);
    }

    const tempDir = path.join(os.tmpdir(), `adobe-extract-${Date.now()}`);
    fs.mkdirSync(tempDir);
    const outputZipPath = path.join(tempDir, 'extracted_output.zip');

    try {
        // 1. Setup Authentication
        const credentials = PDFServicesSdk.Credentials
            .servicePrincipalCredentialsBuilder()
            .withClientId(CLIENT_ID)
            .withClientSecret(CLIENT_SECRET)
            .build();

        const executionContext = PDFServicesSdk.ExecutionContext.create(credentials);

        // 2. Define the Extract Operation to get both figures (images) and JSON
        const extractOperation = PDFServicesSdk.ExtractPDFOperation.createNew();
        const inputAsset = PDFServicesSdk.FileRef.createFromLocalFile(pdfFilePath);
        extractOperation.setInput(inputAsset);

        // Request FIGURES (images) and the structured JSON output
        const extractOptions = PDFServicesSdk.ExtractPDFOptions.builder()
            .addElementsToExtract(PDFServicesSdk.ExtractPDFElements.TEXT, PDFServicesSdk.ExtractPDFElements.FIGURES)
            .addElementsToExtractRenditions(PDFServicesSdk.ExtractRenditionsElementType.FIGURES)
            .addRenditionImageFormat(PDFServicesSdk.ExtractRenditionsFormat.PNG)
            .build();

        extractOperation.setOptions(extractOptions);

        // 3. Execute the Operation and Download ZIP
        const resultAsset = await extractOperation.execute(executionContext);
        await resultAsset.saveAsFile(outputZipPath);
        
        // --- Custom Processing for Image Naming ---

        // 4. Extract Text Labels (Accession Numbers) from the original PDF text for sequential matching
        const dataBuffer = fs.readFileSync(pdfFilePath);
        const pdfText = (await pdf(dataBuffer)).text;
        let foundLabels = [];
        let match;

        while ((match = ARTIFACT_ID_REGEX.exec(pdfText)) !== null) {
            // Clean illegal filename characters from the label
            const label = match[0].trim().replace(/[<>:"/\\|?*]/g, '_'); 
            if (!foundLabels.includes(label)) {
                foundLabels.push(label);
            }
        }
        
        // 5. Unzip the results and process them
        const zip = new AdmZip(outputZipPath);
        // The ZIP extraction is done to the same temp folder (e.g., /tmp/adobe-extract-12345/figures/figure_1.png)
        zip.extractAllTo(tempDir, true); 

        // 6. Match Images to Labels (Sequential Matching)
        const figuresDir = path.join(tempDir, 'figures');
        
        if (!fs.existsSync(figuresDir)) {
             throw new Error("Extraction failed. The Adobe API did not find or generate any embedded figures (images) in the PDF.");
        }
        
        const extractedFiles = fs.readdirSync(figuresDir)
            .filter(file => file.match(/figure_\d+\.png$/i)) // Match figure_1.png, figure_2.png etc.
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        let results = [];
        const itemsToProcess = Math.min(foundLabels.length, extractedFiles.length);

        for (let i = 0; i < itemsToProcess; i++) {
            const originalFileName = extractedFiles[i];
            const label = foundLabels[i];
            const newFileName = `${label}.png`;
            const originalFilePath = path.join(figuresDir, originalFileName);
            const outputFilePath = path.join(tempDir, newFileName); // Save directly to the root of tempDir

            // Rename the file to the new label name
            fs.renameSync(originalFilePath, outputFilePath);

            // Convert buffer to Base64 for display in the Electron canvas
            const imageBuffer = fs.readFileSync(outputFilePath);
            const base64Data = imageBuffer.toString('base64');

            results.push({
                name: newFileName,
                dataUrl: `data:image/png;base64,${base64Data}`,
                filePath: outputFilePath // Crucial for opening the file later
            });
        }
        
        if (results.length === 0) {
            throw new Error("No images were successfully matched to the labels found in the PDF.");
        }

        // Return the list of processed files and the parent temp folder location
        return { 
            imagesWithLabels: results, 
            tempDirectory: tempDir 
        };

    } catch (e) {
        // Clean up the temp directory on failure
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        
        let errorMessage = e.message;
        if (e.message.includes('401')) {
            errorMessage += " (Authentication Failed: Check your Client ID and Client Secret.)";
        }
        throw new Error(`Failed to process PDF: ${errorMessage}`);
    }
}

module.exports = {
    extractImagesAndLabels
};