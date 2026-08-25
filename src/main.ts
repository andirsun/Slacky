import { BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'

import { SlackyEvent } from './events'
import { registerScreenShareHandler } from './screen-share'
import { defaultUserAgent, enhanceSession } from './session'
import { applyExternalLinkPolicy } from './session/external-links'

export default class Main {
  static mainWindow: Electron.BrowserWindow | null
  static application: Electron.App

  private static onWindowAllClosed() {
    if (process.platform !== 'darwin') Main.application.quit()
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
      title: 'Slacky',
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

    // Covers the popped-out huddle too: it shares the main window's session.
    registerScreenShareHandler(Main.mainWindow.webContents.session, () => Main.mainWindow)

    Main.mainWindow.loadURL(SLACK_APP_URL, {
      userAgent: defaultUserAgent
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

  static main(app: Electron.App) {
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
