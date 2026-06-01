import { BrowserWindow, shell, Session, OnBeforeSendHeadersListenerDetails, BeforeSendResponse, ipcMain } from 'electron'
import enhanceWebRequest from 'electron-better-web-request'
import * as path from 'path'

const defaultUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

const enhanceSession = (session: Session) => {
  enhanceWebRequest(session)
  session.setUserAgent(defaultUserAgent)
  session.webRequest.onBeforeSendHeaders(
    (details: OnBeforeSendHeadersListenerDetails, callback: (beforeSendResponse: BeforeSendResponse) => void) => {
      details.requestHeaders['User-Agent'] = defaultUserAgent
      details.requestHeaders['Referer'] = details.referrer
      callback({
        cancel: false,
        requestHeaders: details.requestHeaders
      })
    }
  )
}

export default class Main {
  static mainWindow: Electron.BrowserWindow | null
  static application: Electron.App
  static BrowserWindow

  private static onWindowAllClosed() {
    if (process.platform !== 'darwin')
      Main.application.quit()
    
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
      autoHideMenuBar: true,
      center: true,
      webPreferences: {
        // contextIsolation must be off so the preload can patch the same
        // `window.Notification` that Slack's page scripts use. nodeIntegration
        // stays off so the remote Slack code still gets no Node access; the
        // preload keeps Node/IPC privileges via its own closure.
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: false,
        preload: path.join(__dirname, 'preload.js')
      }
    })

    /**
     * Open links in the default browser except for slack.com operations.
     */
    Main.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.includes('slack.com')) {
        // Open if URL belongs to slack.com
        return { action: 'allow' }
      } else {
        // Open external links in the system's default browser
        shell.openExternal(url)
        return { action: 'deny' } // Deny Electron from opening new windows directly
      }
    })

    // Intercept link navigation within the page
    Main.mainWindow.webContents.on('will-navigate', (event, url) => {
      if (!url.includes('slack.com')) {
        event.preventDefault() // Prevent navigation
        shell.openExternal(url) // Open in external OS browser
        return { action: 'deny' }
      }
      return { action: 'allow' }
    })

    Main.mainWindow.loadURL(SLACK_APP_URL, {
      userAgent: defaultUserAgent,
    })
   
    // Stop flashing the taskbar entry once the window is actually focused.
    Main.mainWindow.on('focus', () => Main.mainWindow?.flashFrame(false))

    Main.mainWindow.on('closed', Main.onClose)
  }

  /**
   * Bring the Slacky window back to the foreground. Triggered from the preload
   * when a Slack notification is clicked. On Linux (especially Wayland) the
   * compositor may refuse to let an app raise itself, so we restore + show +
   * focus and fall back to flashing the taskbar entry as an urgency hint.
   */
  private static onNotificationClicked() {
    const win = Main.mainWindow
    if (!win) return

    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.flashFrame(true)
  }

  static main(app: Electron.App, browserWindow: typeof BrowserWindow) {
    Main.BrowserWindow = browserWindow
    Main.application = app
    Main.application.on('window-all-closed', Main.onWindowAllClosed)
    Main.application.on('ready', Main.onReady)

    ipcMain.on('slacky:notification-clicked', Main.onNotificationClicked)

    Main.application.on('session-created', (session) => {
      enhanceSession(session)
    })

    /**
     * Define custom protocol handler. Deep linking works on packaged versions of the application ONLY
     * to use it, you can open links on browser with the following url: slack://<your-path>
     * docs: https://api.slack.com/reference/deep-linking
     */
    if (!Main.application.isDefaultProtocolClient('slack'))
      Main.application.setAsDefaultProtocolClient('slack')
  }
}
