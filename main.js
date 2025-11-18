const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { extractImagesAndLabels } = require('./pdf-extract-library');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
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

// --- IPC Communication Handlers ---

// Handler for the main extraction logic
ipcMain.handle('start-processing', async (event, pdfFilePath) => {
    try {
        const result = await extractImagesAndLabels(pdfFilePath);
        return result;
    } catch (error) {
        // Send a detailed error message back to the renderer
        console.error("Main Process Error:", error);
        throw new Error(error.message);
    }
});

// NEW: Handler for opening the extracted file in the OS's default application
ipcMain.handle('open-file-in-shell', async (event, filePath) => {
    try {
        await shell.openPath(filePath);
    } catch (error) {
        console.error("Shell Open Error:", error);
        // Show an error to the user if the file couldn't be opened
        dialog.showErrorBox('File Open Error', `Could not open file: ${path.basename(filePath)}\nDetails: ${error.message}`);
    }
});

// NEW: Handler for clearing the temporary folder
ipcMain.handle('clear-temp', (event, tempDirPath) => {
    try {
        if (tempDirPath && fs.existsSync(tempDirPath)) {
            // Use rmSync with recursive/force for reliable deletion of the folder and contents
            fs.rmSync(tempDirPath, { recursive: true, force: true });
            console.log(`Cleaned up temp directory: ${tempDirPath}`);
        }
    } catch (error) {
        console.error("Temp Cleanup Error:", error);
    }
});