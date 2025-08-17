import { App, BrowserWindow } from 'electron';

type MoveDirection = 'left' | 'right' | 'up' | 'down';

interface ShortcutDeps {
  app: App;
  getMainWindow: () => BrowserWindow | null;
  handleTakeScreenshot: () => Promise<void>;
  handleProcessScreenshots: () => Promise<void>;
  handleResetQueue: () => Promise<void>;
  moveWindow: (direction: MoveDirection) => void;
  toggleVisualHidden: () => void;
}

export function installShortcutArgHandlers(deps: ShortcutDeps) {
  const { app, getMainWindow, handleTakeScreenshot, handleProcessScreenshots, handleResetQueue, moveWindow, toggleVisualHidden } = deps;

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  const handleArgv = async (argv: string[]) => {
    try {
      if (argv.includes('--screenshot')) {
        await handleTakeScreenshot();
      }
      if (argv.includes('--process')) {
        await handleProcessScreenshots();
      }
      if (argv.includes('--reset')) {
        await handleResetQueue();
      }
      if (argv.includes('--quit')) {
        app.quit();
      }
      if (argv.includes('--toggle-visibility')) {
        toggleVisualHidden();
      }
      if (argv.includes('--page-up')) {
        getMainWindow()?.webContents.send('page-scroll', 'up');
      }
      if (argv.includes('--page-down')) {
        getMainWindow()?.webContents.send('page-scroll', 'down');
      }
      if (argv.includes('--move-left')) {
        moveWindow('left');
      }
      if (argv.includes('--move-right')) {
        moveWindow('right');
      }
      if (argv.includes('--move-up')) {
        moveWindow('up');
      }
      if (argv.includes('--move-down')) {
        moveWindow('down');
      }
      if (argv.includes('--toggle-config')) {
        getMainWindow()?.webContents.send('show-config');
      }
    } catch (error) {
      console.error('Error handling argv:', error);
    }
  };

  app.on('second-instance', (_event, argv) => {
    handleArgv(argv);
  });

  const initialArgs = process.argv.slice(1);
  if (initialArgs.length > 0) {
    app.whenReady().then(() => handleArgv(initialArgs));
  }
}


