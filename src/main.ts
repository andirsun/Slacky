import { BrowserWindow, shell, Session, OnBeforeSendHeadersListenerDetails, BeforeSendResponse, ipcMain } from 'electron'
import * as path from 'path'
import { SlackyEvent } from './events'

const defaultUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

const enhanceSession = (session: Session) => {
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

/**
 * A URL is "external" only when it is a real http(s) link that does not belong
 * to Slack. Internal targets — most importantly `about:blank`, which Slack uses
 * when it pops a huddle out via `window.open()` and then drives the returned
 * window itself — must stay inside Electron.
 */
const isExternalUrl = (url: string): boolean =>
  /^https?:\/\//i.test(url) && !url.includes('slack.com')

/**
 * Route genuinely external links to the system browser while letting Slack's
 * own windows (slack.com pages and the `about:blank` huddle pop-out) open as
 * native Electron windows. Denying the pop-out used to make `window.open()`
 * return null, which Slack reported as "Unable to create window".
 */
const applyExternalLinkPolicy = (contents: Electron.WebContents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url)
      return { action: 'deny' } // Deny Electron from opening new windows directly
    }
    return { action: 'allow' }
  })

  // Intercept in-page navigation; keep external links in the OS browser.
  contents.on('will-navigate', (event, url) => {
    if (isExternalUrl(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })
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

    // Keep external links in the OS browser; let Slack's own windows
    // (including the about:blank huddle pop-out) open natively.
    applyExternalLinkPolicy(Main.mainWindow.webContents)

    // Apply the same policy to windows Slack opens (e.g. the popped-out huddle)
    // so links clicked inside them still go to the OS browser.
    Main.mainWindow.webContents.on('did-create-window', (childWindow) => {
      childWindow.setMenuBarVisibility(false)
      applyExternalLinkPolicy(childWindow.webContents)
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

    ipcMain.on(SlackyEvent.NotificationClicked, Main.onNotificationClicked)

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
