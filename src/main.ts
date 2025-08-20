import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import openaiService from './services/openai';
import { installShortcutArgHandlers } from './shortcuts';
import { installCommandServer } from './commandServer';
import pythonDaemon from './pythonDaemon';

const execFileAsync = promisify(execFile);

interface Screenshot {
  id: number;
  preview: string;
  path: string;
}

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
console.log(CONFIG_FILE);

interface Config {
  apiKey: string;
  language: string;
}

let config: Config | null = null;

let mainWindow: BrowserWindow | null = null;
let screenshotQueue: Screenshot[] = [];
let isProcessing = false;
const MAX_SCREENSHOTS = 4;
const SCREENSHOT_DIR = path.join(app.getPath('temp'), 'screenshots');
let isVisualHidden = false;
const MODEL_CANDIDATES = [
  'openai/gpt-5-chat',
  'openai/o4-mini',
  'openai/o4-mini-high',
  'openai/o3'
];
let currentModelIndex = 0;
let proMode = false;

async function ensureScreenshotDir() {
  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating screenshot directory:', error);
  }
}

async function loadConfig(): Promise<Config | null> {
  try {
    // First try loading from environment variables
    const envApiKey = process.env.OPENAI_API_KEY;
    const envLanguage = process.env.APP_LANGUAGE;

    if (envApiKey && envLanguage) {
      const envConfig = {
        apiKey: envApiKey,
        language: envLanguage
      };
      openaiService.updateConfig(envConfig);
      return envConfig;
    }

    // If env vars not found, try loading from config file
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    const loadedConfig = JSON.parse(data);
    if (loadedConfig && loadedConfig.apiKey && loadedConfig.language) {
      openaiService.updateConfig(loadedConfig);
      return loadedConfig;
    }
    return null;
  } catch (error) {
    console.error('Error loading config:', error);
    return null;
  }
}

async function saveConfig(newConfig: Config): Promise<void> {
  try {
    if (!newConfig.apiKey || !newConfig.language) {
      throw new Error('Invalid configuration');
    }
    await fs.writeFile(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    config = newConfig;
    // Update OpenAI service with new config
    openaiService.updateConfig(newConfig);
  } catch (error) {
    console.error('Error saving config:', error);
    throw error;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,           
    transparent: true,     
    backgroundColor: "#00000000",  
    hasShadow: false,    
    alwaysOnTop: true,     
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Open DevTools by default in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Register DevTools shortcut
  // Shortcut registration moved out; use external triggers via args

  // Enable content protection to prevent screen capture
  mainWindow.setContentProtection(true);

  // Make the window ignore mouse events (click-through)
  mainWindow.setIgnoreMouseEvents(true);

  // Platform specific enhancements for macOS
  if (process.platform === 'darwin') {
    mainWindow.setHiddenInMissionControl(true);
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    });
    mainWindow.setAlwaysOnTop(true, "floating");
  }

  // Load the index.html file from the dist directory
  mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));

  // Install arg-based shortcut handlers (Fn-based via Karabiner or other launchers)
  installShortcutArgHandlers({
    app,
    getMainWindow: () => mainWindow,
    handleTakeScreenshot,
    handleProcessScreenshots,
    handleResetQueue,
    moveWindow,
    toggleVisualHidden: () => {
      isVisualHidden = !isVisualHidden;
      mainWindow?.setOpacity(isVisualHidden ? 0 : 1);
    }
  });

  // Install local command server for focusless triggers (e.g., Karabiner curl)
  installCommandServer({
    port: 3939,
    pageScroll: (dir) => mainWindow?.webContents.send('page-scroll', dir),
    moveWindow,
    triggerScreenshot: handleTakeScreenshot,
    triggerProcess: async () => {
      if (!proMode) {
        await handleProcessScreenshots();
        return;
      }
      try {
        const models = ['openai/gpt-5-chat', 'openai/o4-mini-high', 'openai/o3'];
        mainWindow?.webContents.send('processing-started');
        const results = await Promise.all(models.map(async (m) => {
          try {
            const r = await openaiService.processScreenshots(screenshotQueue, m);
            return { model: m, ok: true, data: r };
          } catch (e: any) {
            return { model: m, ok: false, error: e?.message || 'error' };
          }
        }));
        mainWindow?.webContents.send('processing-complete', JSON.stringify({ pro: true, results }));
      } catch (e) {
        mainWindow?.webContents.send('processing-complete', JSON.stringify({ pro: true, results: [] }));
      }
    },
    triggerReset: handleResetQueue,
    toggleVisualHidden: () => {
      isVisualHidden = !isVisualHidden;
      mainWindow?.setOpacity(isVisualHidden ? 0 : 1);
    },
    toggleConfig: () => mainWindow?.webContents.send('show-config'),
    setModel: (index: number) => {
      if (index < 0 || index >= MODEL_CANDIDATES.length) return;
      currentModelIndex = index;
      if (proMode) {
        proMode = false;
        mainWindow?.webContents.send('pro-mode-updated', { enabled: proMode });
      }
      mainWindow?.webContents.send('model-updated', {
        index: currentModelIndex,
        name: MODEL_CANDIDATES[currentModelIndex]
      });
    },
    getModelList: () => ({
      currentIndex: currentModelIndex,
      models: MODEL_CANDIDATES
    }),
    toggleProMode: () => {
      proMode = !proMode;
      mainWindow?.webContents.send('pro-mode-updated', { enabled: proMode });
    },
    restartApp: () => {
      app.relaunch();
      app.exit(0);
    }
  });

  // Toggle pro-mode via arg-based trigger
  // Expose as IPC to the renderer too
  ipcMain.on('toggle-pro-mode', () => {
    proMode = !proMode;
    mainWindow?.webContents.send('pro-mode-updated', { enabled: proMode });
  });
}

// Removed globalShortcut registration; handled via arg-based triggers

async function captureScreenshot(): Promise<Buffer> {
  if (process.platform === 'darwin') {
    const tmpPath = path.join(SCREENSHOT_DIR, `${Date.now()}.png`);
    await execFileAsync('screencapture', ['-x', tmpPath]);
    const buffer = await fs.readFile(tmpPath);
    await fs.unlink(tmpPath);
    return buffer;
  } else {
    // Windows implementation
    const tmpPath = path.join(SCREENSHOT_DIR, `${Date.now()}.png`);
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen
      $bitmap = New-Object System.Drawing.Bitmap $screen.Bounds.Width, $screen.Bounds.Height
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($screen.Bounds.X, $screen.Bounds.Y, 0, 0, $bitmap.Size)
      $bitmap.Save('${tmpPath.replace(/\\/g, "\\\\")}')
      $graphics.Dispose()
      $bitmap.Dispose()
    `;
    await execFileAsync('powershell', ['-command', script]);
    const buffer = await fs.readFile(tmpPath);
    await fs.unlink(tmpPath);
    return buffer;
  }
}

async function handleTakeScreenshot() {
  if (screenshotQueue.length >= MAX_SCREENSHOTS) return;

  try {
    // Directly capture without altering window visibility or opacity
    await new Promise(resolve => setTimeout(resolve, 50));

    const buffer = await captureScreenshot();
    const id = Date.now();
    const screenshotPath = path.join(SCREENSHOT_DIR, `${id}.png`);
    
    await fs.writeFile(screenshotPath, buffer);
    const preview = `data:image/png;base64,${buffer.toString('base64')}`;
    
    const screenshot = { id, preview, path: screenshotPath };
    screenshotQueue.push(screenshot);
    mainWindow?.webContents.send('screenshot-taken', screenshot);
  } catch (error) {
    console.error('Error taking screenshot:', error);
  }
}

async function handleProcessScreenshots() {
  if (isProcessing || screenshotQueue.length === 0) return;
  
  isProcessing = true;
  mainWindow?.webContents.send('processing-started');

  try {
    const result = await openaiService.processScreenshots(screenshotQueue);
    // Check if processing was cancelled
    if (!isProcessing) return;
    mainWindow?.webContents.send('processing-complete', JSON.stringify(result));
  } catch (error: any) {
    console.error('Error processing screenshots:', error);
    // Check if processing was cancelled
    if (!isProcessing) return;
    
    // Extract the most relevant error message
    let errorMessage = 'Error processing screenshots';
    if (error?.error?.message) {
      errorMessage = error.error.message;
    } else if (error?.message) {
      errorMessage = error.message;
    }
    
    mainWindow?.webContents.send('processing-complete', JSON.stringify({
      error: errorMessage,
      approach: 'Error occurred while processing',
      code: 'Error: ' + errorMessage,
      timeComplexity: 'N/A',
      spaceComplexity: 'N/A'
    }));
  } finally {
    isProcessing = false;
  }
}

async function handleResetQueue() {
  // Cancel any ongoing processing
  if (isProcessing) {
    isProcessing = false;
    mainWindow?.webContents.send('processing-complete', JSON.stringify({
      approach: 'Processing cancelled',
      code: '',
      timeComplexity: '',
      spaceComplexity: ''
    }));
  }

  // Delete all screenshot files
  for (const screenshot of screenshotQueue) {
    try {
      await fs.unlink(screenshot.path);
    } catch (error) {
      console.error('Error deleting screenshot:', error);
    }
  }
  
  screenshotQueue = [];
  mainWindow?.webContents.send('queue-reset');
}

function handleToggleVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
}

function moveWindow(direction: 'left' | 'right' | 'up' | 'down') {
  if (!mainWindow) return;
  
  const [x, y] = mainWindow.getPosition();
  const moveAmount = 50;
  
  switch (direction) {
    case 'left':
      mainWindow.setPosition(x - moveAmount, y);
      break;
    case 'right':
      mainWindow.setPosition(x + moveAmount, y);
      break;
    case 'up':
      mainWindow.setPosition(x, y - moveAmount);
      break;
    case 'down':
      mainWindow.setPosition(x, y + moveAmount);
      break;
  }
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  await ensureScreenshotDir();
  // Load config before creating window
  config = await loadConfig();
  createWindow();

  // Start python daemon early
  try {
    await pythonDaemon.start();
  } catch (err) {
    console.error('Failed to start Python daemon:', err);
  }
  console.log("[PythonTest] starting daemon test");
  // Run a simple test after window shows
  runPythonDaemonTest();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  handleResetQueue();
  pythonDaemon.stop();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('take-screenshot', handleTakeScreenshot);
ipcMain.handle('process-screenshots', handleProcessScreenshots);
ipcMain.handle('reset-queue', handleResetQueue);

// Python daemon IPC
ipcMain.handle('python-load', async (_evt, code: string) => {
  try {
    return await pythonDaemon.load(code);
  } catch (err: any) {
    return { id: -1, ok: false, error: err?.message || 'load failed' };
  }
});

ipcMain.handle('python-run', async (_evt, input?: string) => {
  try {
    return await pythonDaemon.run(input);
  } catch (err: any) {
    return { id: -1, ok: false, error: err?.message || 'run failed' };
  }
});

// Window control events
ipcMain.on('minimize-window', () => {
  mainWindow?.minimize();
});

ipcMain.on('maximize-window', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow?.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('close-window', () => {
  mainWindow?.close();
});

ipcMain.on('quit-app', () => {
  app.quit();
});

ipcMain.on('toggle-visibility', handleToggleVisibility);

// Add these IPC handlers before app.whenReady()
ipcMain.handle('get-config', async () => {
  try {
    if (!config) {
      config = await loadConfig();
    }
    return config;
  } catch (error) {
    console.error('Error getting config:', error);
    return null;
  }
});

ipcMain.handle('save-config', async (_, newConfig: Config) => {
  try {
    await saveConfig(newConfig);
    return true;
  } catch (error) {
    console.error('Error in save-config handler:', error);
    return false;
  }
}); 

// Buggy variant generator IPC
ipcMain.handle('generate-buggy-variant', async (_evt, payload: { code: string; approach?: string; modelOverride?: string }) => {
  try {
    console.log('[Buggy] Generating buggy variant...');
    const res = await openaiService.generateBuggyVariant({
      code: payload.code,
      approach: payload.approach,
      modelOverride: payload.modelOverride
    });
    console.log('[Buggy] Result received');
    return res;
  } catch (err: any) {
    console.error('[Buggy] Error generating buggy variant:', err);
    return { responseType: 'buggyVariant', intent: 'introduce_mistakes', mistakeSummary: err?.message || 'error', edits: [{ description: 'error', rationale: err?.message || 'unknown' }], buggyCode: payload.code };
  }
});

async function runPythonDaemonTest() {
  try {
    const sampleCode = [
      'import sys',
      'data = sys.stdin.read().strip()',
      'print(data.upper())'
    ].join('\n');
    const loadRes = await pythonDaemon.load(sampleCode);
    console.log('[PythonTest] load:', loadRes);
    const runRes = await pythonDaemon.run('hello world');
    console.log('[PythonTest] run:', runRes);
  } catch (err) {
    console.error('[PythonTest] error:', err);
  }
}