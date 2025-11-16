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
 * STEP 1: Process the file (extract labels) and automatically save results.
 */
ipcMain.handle('start-processing', async (event, { filePath, savePath }) => {
    event.sender.send('update-status', 'Starting PDF content analysis...');
    
    try {
        // 1. Extract Generalized Labels (Artifact IDs) using pdf-parse
        const extractionResults = await pdfExtractor.extractImagesWithLabels(filePath);
        
        event.sender.send('update-status', `Found ${extractionResults.length} artifact labels. Starting automated save...`);

        // 2. Automatically trigger the saving process
        const saveResponse = await handleAutoSave(event, extractionResults, savePath);
        
        // Return both results and save status to the renderer
        return {
            results: extractionResults,
            saveStatus: saveResponse
        };

    } catch (error) {
        console.error("Error during PDF processing:", error);
        event.sender.send('update-status', `Error processing PDF. Check that 'npm install' was run and the PDF is not encrypted.`);
        throw new Error(`Failed to process PDF: ${error.message}`);
    }
});

/**
 * STEP 2: Core file saving function (triggered automatically).
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
            // Data is Base64 encoded from the placeholder generator
            const base64Data = item.dataUrl.split(';base64,').pop();
            
            // Clean filename and enforce PNG extension
            const baseName = item.name.replace(/\.jpg|\.jpeg|\.png|\.gif$/i, ''); 
            const cleanedFileName = `${baseName.replace(/[^a-zA-Z0-9\s\.\-]/g, '').trim()}.png`;
            const filePath = path.join(savePath, cleanedFileName);
            
            // Write PNG Buffer to disk
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
        const successMessage = `Successfully saved ${filesSaved} files to ${savePath}.`;
        event.sender.send('update-status', successMessage);
        return { success: true, message: successMessage };
    }
}

/**
 * Handles the request to download a single file. (Kept for completeness/debugging)
 */
ipcMain.handle('download-single', async (event, item) => {
    const baseName = item.name.replace(/\.jpg|\.jpeg|\.png|\.gif$/i, ''); 
    const cleanedFileName = `${baseName.replace(/[^a-zA-Z-Z0-9\s\.\-]/g, '').trim()}.png`;

    const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save Image',
        defaultPath: cleanedFileName,
        filters: [
            { name: 'PNG Image', extensions: ['png'] }
        ]
    });

    if (canceled || !filePath) {
        return { success: false, message: 'Save operation cancelled.' };
    }

    try {
        const base64Data = item.dataUrl.split(';base64,').pop();
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        event.sender.send('update-status', `Saved ${item.name}.`);
        return { success: true, message: `Successfully saved ${item.name}` };
    } catch (err) {
        event.sender.send('update-status', `Error saving ${item.name}.`);
        return { success: false, message: `Failed to save ${item.name}.` };
    }
});

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
