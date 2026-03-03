const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    installNow: () => ipcRenderer.invoke("updater:install-now"),
    repair: () => ipcRenderer.invoke("updater:repair"),
    getStatus: () => ipcRenderer.invoke("updater:get-status"),
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("updater:status", listener);
      return () => {
        ipcRenderer.removeListener("updater:status", listener);
      };
    },
  },
});
