// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Try to require the extraction library but don't let a require-time failure crash the whole app.
let pdfExtractor = null;
try {
  pdfExtractor = require('./pdf-extract-library');
} catch (e) {
  console.warn('pdf-extract-library failed to load at startup:', e && e.message ? e.message : e);
  // We'll re-attempt require inside the handler and provide a clear error if missing.
}

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

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// select save directory
ipcMain.handle('select-save-directory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Folder to Save All Images'
  });
  return canceled ? null : filePaths[0];
});

// open file dialog for PDF
ipcMain.handle('open-file-dialog', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('start-processing', async (event, { filePath, savePath }) => {
  event.sender.send('update-status', 'Starting PDF content analysis and image extraction...');

  // Re-attempt loading the extractor if it wasn't available at startup
  if (!pdfExtractor) {
    try { pdfExtractor = require('./pdf-extract-library'); }
    catch (e) {
      const msg = `Extraction module missing or failed to load: ${e && e.message ? e.message : e}`;
      event.sender.send('update-status', `CRITICAL ERROR: ${msg}`);
      throw new Error(msg);
    }
  }

  let tempDir = null;
  try {
    const extractionResponse = await pdfExtractor.extractImagesAndLabels(filePath);
    const { imagesWithLabels, tempDirectory } = extractionResponse;
    tempDir = tempDirectory;

    event.sender.send('update-status', `Found ${imagesWithLabels.length} artifacts. Starting automated save...`);
    const saveResponse = await handleAutoSave(event, imagesWithLabels, savePath);

    return { results: imagesWithLabels, saveStatus: saveResponse };
  } catch (error) {
    console.error("Critical Error during PDF processing:", error);
    event.sender.send('update-status', `CRITICAL ERROR: Failed to extract images. Ensure Poppler is installed/accessible. Error: ${error.message}`);
    throw new Error(`Failed to process PDF: ${error.message}`);
  } finally {
    if (tempDir && fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); console.log(`Cleaned up temp dir: ${tempDir}`); }
      catch (e) { console.error(`Failed to clean up temp dir ${tempDir}:`, e); }
    }
  }
});

async function handleAutoSave(event, extractionResults, savePath) {
  const fs = require('fs');
  const path = require('path');

  let filesSaved = 0;
  let errors = [];

  try {
    if (!fs.existsSync(savePath)) fs.mkdirSync(savePath, { recursive: true });
  } catch (e) {
    return { success: false, message: `Failed to create directory: ${e.message}` };
  }

  for (const item of extractionResults) {
    try {
      const base64Data = item.dataUrl.split(';base64,').pop();
      const baseName = item.name.replace(/\.jpg|\.jpeg|\.png|\.gif$/i, '');
      const cleanedFileName = `${baseName.replace(/[^a-zA-Z0-9\s\.\-]/g, '').trim()}.png`;
      const filePath = path.join(savePath, cleanedFileName);
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