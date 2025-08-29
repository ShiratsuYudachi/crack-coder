import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  close: () => ipcRenderer.send('close-window'),
  quit: () => ipcRenderer.send('quit-app'),
  
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  processScreenshots: () => ipcRenderer.invoke('process-screenshots'),
  resetQueue: () => ipcRenderer.invoke('reset-queue'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
  pythonLoad: (code: string) => ipcRenderer.invoke('python-load', code),
  pythonRun: (input?: string) => ipcRenderer.invoke('python-run', input),
  generateBuggyVariant: (payload: { code: string; approach?: string; modelOverride?: string }) => ipcRenderer.invoke('generate-buggy-variant', payload),
  setCurrentAnswer: (answer: string) => ipcRenderer.invoke('set-current-answer', answer),
  
  toggleVisibility: () => ipcRenderer.send('toggle-visibility'),
  
  onProcessingComplete: (callback: (result: string) => void) => {
    ipcRenderer.on('processing-complete', (_, result) => callback(result));
  },
  onScreenshotTaken: (callback: (data: any) => void) => {
    ipcRenderer.on('screenshot-taken', (_, data) => callback(data));
  },
  onProcessingStarted: (callback: () => void) => {
    ipcRenderer.on('processing-started', () => callback());
  },
  onQueueReset: (callback: () => void) => {
    ipcRenderer.on('queue-reset', () => callback());
  },
  onShowConfig: (callback: () => void) => {
    ipcRenderer.on('show-config', () => callback());
  },
  onPageScroll: (callback: (direction: 'up' | 'down') => void) => {
    ipcRenderer.on('page-scroll', (_, direction: 'up' | 'down') => callback(direction));
  },
  onModelUpdated: (callback: (data: { index: number; name: string }) => void) => {
    ipcRenderer.on('model-updated', (_evt, data) => callback(data));
  },
  onProModeUpdated: (callback: (data: { enabled: boolean }) => void) => {
    ipcRenderer.on('pro-mode-updated', (_evt, data) => callback(data));
  },
  toggleProMode: () => ipcRenderer.send('toggle-pro-mode')
}); 