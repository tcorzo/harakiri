import { contextBridge, ipcRenderer } from "electron";

import { createBridge } from "./bridge";

contextBridge.exposeInMainWorld(
  "harakiri",
  createBridge(ipcRenderer, {
    // Sandboxed preloads cannot read the main process's env; main passes the flag through argv.
    e2e: process.argv.includes("--harakiri-e2e"),
    warn: (message, detail) => console.warn(message, detail),
  })
);
