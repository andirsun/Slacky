import { BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'

import { SlackyEvent } from './events'
import { registerScreenShareHandler } from './screen-share'
import { defaultUserAgent, enhanceSession } from './session'
import { applyExternalLinkPolicy } from './session/external-links'
import { createTray, slackyIcon } from './tray'

export default class Main {
  static mainWindow: Electron.BrowserWindow | null
  static application: Electron.App
  /** Kept alive so the StatusNotifierItem is not garbage-collected. */
  static tray: Electron.Tray | null

  /**
   * Set from `before-quit` so a real exit (tray Quit, or the session ending)
   * is allowed to destroy the window. The window's close button hides to the
   * tray instead; without this flag `preventDefault` would also swallow
   * `app.quit()` and Slacky could not exit.
   */
  private static quitting = false

  private static onWindowAllClosed() {
    if (process.platform !== 'darwin') Main.application.quit()
  }

  /**
   * The title-bar close button (and Alt+F4) hide Slacky to the tray. The
   * process keeps running and the StatusNotifierItem stays registered.
   */
  private static onClose(event: Electron.Event) {
    if (Main.quitting) return
    event.preventDefault()
    Main.mainWindow?.hide()
  }

  private static onClosed() {
    Main.mainWindow = null
  }

  private static onReady() {
    const SLACK_APP_URL = 'https://app.slack.com/client'
    const icon = slackyIcon()

    Main.mainWindow = new BrowserWindow({
      roundedCorners: true,
      width: 1920,
      height: 1080,
      title: 'Slacky',
      icon,
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

    Main.mainWindow.on('close', Main.onClose)
    Main.mainWindow.on('closed', Main.onClosed)

    Main.tray = createTray(Main.present, () => Main.application.quit())
  }

  /**
   * Bring the Slacky window back to the foreground. Used by the tray icon,
   * a second launch, and a clicked Slack notification. On Linux (especially
   * Wayland) the compositor may refuse to let an app raise itself, so we
   * restore + show + focus and fall back to flashing the taskbar entry as an
   * urgency hint when focus did not take.
   */
  private static present() {
    const win = Main.mainWindow
    if (!win) return

    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (!win.isFocused()) win.flashFrame(true)
  }

  static main(app: Electron.App) {
    Main.application = app

    // A launcher click while Slacky is hidden in the tray must focus the
    // running process, not start another one.
    const gotLock = app.requestSingleInstanceLock()
    if (!gotLock) {
      app.quit()
      return
    }

    app.on('second-instance', () => Main.present())
    app.on('before-quit', () => {
      Main.quitting = true
    })
    Main.application.on('window-all-closed', Main.onWindowAllClosed)
    Main.application.on('ready', Main.onReady)

    ipcMain.on(SlackyEvent.NotificationClicked, Main.present)

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
