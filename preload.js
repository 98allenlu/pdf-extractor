const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Exposes the main processing function
    startProcessing: (pdfFilePath) => ipcRenderer.invoke('start-processing', pdfFilePath),
    
    // NEW: Exposes the function to open the extracted file in the system shell
    openFile: (filePath) => ipcRenderer.invoke('open-file-in-shell', filePath),

    // NEW: Exposes the function to clean up the temporary directory
    clearTemp: (tempDirPath) => ipcRenderer.invoke('clear-temp', tempDirPath)
});