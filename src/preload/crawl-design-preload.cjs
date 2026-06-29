const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__rpaDesign', {
  sendPick: (payload) => ipcRenderer.send('crawl:design-pick', payload),
  sendHover: (payload) => ipcRenderer.send('crawl:design-hover', payload),
});
