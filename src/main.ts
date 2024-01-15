import { BrowserWindow, shell } from 'electron';

export default class Main {
  static mainWindow: Electron.BrowserWindow | null
  static application: Electron.App
  static BrowserWindow

  private static onWindowAllClosed() {
    if (process.platform !== 'darwin') {
      Main.application.quit();
    }
  }

  private static onClose() {
    // Dereference the window object. 
    Main.mainWindow = null
  }

  private static onReady() {
    const SLACK_APP_URL = 'https://app.slack.com/client'
  
    Main.mainWindow = new BrowserWindow({
      roundedCorners: true,
      width: 1920,
      height: 1080,
      title: 'Slack ARM',
      center: true,
      webPreferences: {
        nodeIntegration: true
      }
    })
  
    /**
     * Open links in the default browser
     */
    Main.mainWindow.webContents.setWindowOpenHandler(({url}) => {
      void shell.openExternal(url)
      // We need to return 'deny' in order to not open a new electron window
      // Works like e.preventDefault()
      return {action: 'deny'}
    })
  
    Main.mainWindow.loadURL(SLACK_APP_URL, {
      // TODO: Fix this hacky way to get around Slack's user agent check
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/53/7.36 (KHTML, like Gecko) HeadlessChrome/120.0.6099.71 Safari/537.36'
    })
   
    Main.mainWindow.on('closed', Main.onClose);
  }

  static main(app: Electron.App, browserWindow: typeof BrowserWindow) {
    Main.BrowserWindow = browserWindow;
    Main.application = app;
    Main.application.on('window-all-closed', Main.onWindowAllClosed);
    Main.application.on('ready', Main.onReady);

    /**
     * Define custom protocol handler. Deep linking works on packaged versions of the application ONLY
     * to use it, you can open links on browser with the following url: slack://<your-path>
     * docs: https://api.slack.com/reference/deep-linking
     */
    if (!Main.application.isDefaultProtocolClient('slack'))
      Main.application.setAsDefaultProtocolClient('slack')
  }
}
