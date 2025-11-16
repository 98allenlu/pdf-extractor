const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // File selection dialogs
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    selectSaveDirectory: () => ipcRenderer.invoke('select-save-directory'),
    
    // Core processing function
    startProcessing: (payload) => ipcRenderer.invoke('start-processing', payload),
    
    // Single download for convenience
    downloadSingle: (item) => ipcRenderer.invoke('download-single', item),

    // Listener for status updates from the main process
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, message) => callback(message))
});