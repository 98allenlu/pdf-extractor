const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const pdfExtractor = require('./pdf-extract-library'); 

// --- Main Application Window Logic ---

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});


// --- IPC Handlers (Communication between UI and Native) ---

/**
 * Handles the native file dialog to select the folder where all images will be saved.
 */
ipcMain.handle('select-save-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Folder to Save All Images'
    });

    return canceled ? null : filePaths[0];
});

/**
 * STEP 1: Process the file (extract labels and images) and automatically save results.
 */
ipcMain.handle('start-processing', async (event, { filePath, savePath }) => {
    event.sender.send('update-status', 'Starting PDF content analysis and image extraction...');
    
    let tempDir = null; // Variable to hold the temporary directory path

    try {
        // 1. DUAL EXTRACTION: Calls pdf-extract-library to extract data and create temp files
        const extractionResponse = await pdfExtractor.extractImagesAndLabels(filePath);
        const { imagesWithLabels, tempDirectory } = extractionResponse;
        tempDir = tempDirectory; // Store temp dir for cleanup
        
        event.sender.send('update-status', `Found ${imagesWithLabels.length} artifacts. Starting automated save...`);

        // 2. Automatically trigger the saving process, reading the real image data
        const saveResponse = await handleAutoSave(event, imagesWithLabels, savePath);
        
        return {
            results: imagesWithLabels,
            saveStatus: saveResponse
        };

    } catch (error) {
        console.error("Critical Error during PDF processing:", error);
        event.sender.send('update-status', `CRITICAL ERROR: Failed to extract images. Ensure Poppler is installed/accessible. Error: ${error.message}`);
        throw new Error(`Failed to process PDF: ${error.message}`);
    } finally {
        // 3. Cleanup temporary files created by pdf-poppler in the temp directory
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                // fs.rmSync is a synchronous, recursive delete—necessary before returning.
                fs.rmSync(tempDir, { recursive: true, force: true });
                console.log(`Cleaned up temporary directory: ${tempDir}`);
            } catch (e) {
                console.error(`Failed to clean up temporary directory ${tempDir}:`, e);
            }
        }
    }
});

/**
 * STEP 2: Core file saving function (triggered automatically).
 * Saves the Base64 image data to the user-selected disk location.
 */
async function handleAutoSave(event, extractionResults, savePath) {
    let filesSaved = 0;
    let errors = [];

    // Ensure the directory exists
    try {
        if (!fs.existsSync(savePath)) {
            fs.mkdirSync(savePath, { recursive: true });
        }
    } catch (e) {
        return { success: false, message: `Failed to create directory: ${e.message}` };
    }


    for (const item of extractionResults) {
        try {
            // Data is Base64 encoded from the image buffer
            const base64Data = item.dataUrl.split(';base64,').pop();
            
            // Clean filename and enforce PNG extension
            const baseName = item.name.replace(/\.jpg|\.jpeg|\.png|\.gif$/i, ''); 
            const cleanedFileName = `${baseName.replace(/[^a-zA-Z0-9\s\.\-]/g, '').trim()}.png`;
            const filePath = path.join(savePath, cleanedFileName);
            
            // Write Buffer to disk
            fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
            filesSaved++;
        } catch (err) {
            console.error(`Error saving ${item.name}:`, err);
            errors.push(item.name);
            event.sender.send('update-status', `Error saving ${item.name}`);
        }
    }
    
    if (errors.length > 0) {
        const errorMessage = `Saved ${filesSaved} files to ${savePath}. Failed to save: ${errors.length} file(s).`;
        event.sender.send('update-status', errorMessage);
        return { success: false, message: errorMessage };
    } else {
        const successMessage = `Successfully saved ${filesSaved} images to ${savePath}.`;
        event.sender.send('update-status', successMessage);
        return { success: true, message: successMessage };
    }
}

/**
 * Opens the native file selection dialog for the PDF source.
 */
ipcMain.handle('open-file-dialog', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'PDF Documents', extensions: ['pdf'] }
        ]
    });
    return canceled ? null : filePaths[0];
});

// Note: The download-single handler (not shown here) remains unchanged.