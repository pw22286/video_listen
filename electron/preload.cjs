const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("videoListen", {
  createProject: () => ipcRenderer.invoke("project:create"),
  openProject: (payload) => ipcRenderer.invoke("project:open", payload),
  listRecentProjects: () => ipcRenderer.invoke("project:listRecent"),
  saveProject: (payload) => ipcRenderer.invoke("project:save", payload),
  updateScript: (payload) => ipcRenderer.invoke("project:updateScript", payload),
  updateSetting: (payload) => ipcRenderer.invoke("project:updateSetting", payload),
  updateTtsConfig: (payload) => ipcRenderer.invoke("tts:updateConfig", payload),
  previewTtsVoice: (payload) => ipcRenderer.invoke("tts:previewVoice", payload),
  getTtsPreviewCache: (payload) => ipcRenderer.invoke("tts:getPreviewCache", payload),
  generateScriptTts: (payload) => ipcRenderer.invoke("tts:generateScript", payload),
  generateAllTts: (payload) => ipcRenderer.invoke("tts:generateAll", payload),
  importVideoToProject: (payload) => ipcRenderer.invoke("video:importToProject", payload),
  analyzeVideo: (payload) => ipcRenderer.invoke("video:analyze", payload),
  exportScript: (payload) => ipcRenderer.invoke("script:export", payload),
});
