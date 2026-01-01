const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  selectRootFolder: () => ipcRenderer.invoke('select-root-folder'),
  getRootFolder: () => ipcRenderer.invoke('get-root-folder'),
  loadNoteContent: (filePath) => ipcRenderer.invoke('load-note-content', filePath),
  saveNoteContent: (filePath, content) =>
    ipcRenderer.invoke('save-note-content', filePath, content),
  createNote: (relativePath, template) =>
    ipcRenderer.invoke('create-note', relativePath, template),
  updateNodeLinks: (filePath, links) =>
    ipcRenderer.invoke('update-node-links', filePath, links),
  deleteNote: (filePath) => ipcRenderer.invoke('delete-note', filePath)
});


