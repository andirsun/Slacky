import { BrowserWindow, shell, Session, OnBeforeSendHeadersListenerDetails, BeforeSendResponse, ipcMain, desktopCapturer } from 'electron'
import * as path from 'path'
import { SlackyEvent } from './events'

const defaultUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char] as string
  ))

/**
 * Build the standalone HTML used by the screen-share picker window. Each
 * capturable source (screen or window) is embedded directly as a clickable
 * card — including its thumbnail as a data URL — so the picker renderer needs
 * no further IPC to populate itself. Clicking a card (or Cancel) sends the
 * chosen source id (or null) back to the main process.
 */
const buildScreenSharePickerHtml = (sources: Electron.DesktopCapturerSource[], channel: string): string => {
  const cards = sources.map((source) => `
    <button class="source" data-id="${escapeHtml(source.id)}">
      <img src="${source.thumbnail.toDataURL()}" alt="">
      <span title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</span>
    </button>`).join('')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; background: #1a1d21; color: #e8e8e8; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .source { display: flex; flex-direction: column; gap: 8px; padding: 8px; background: #222529; border: 2px solid transparent; border-radius: 8px; cursor: pointer; color: inherit; text-align: left; }
  .source:hover { border-color: #1264a3; background: #2a2e33; }
  .source img { width: 100%; height: 124px; object-fit: cover; background: #000; border-radius: 4px; }
  .source span { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .actions { margin-top: 20px; text-align: right; }
  #cancel { padding: 8px 18px; font-size: 14px; border-radius: 6px; border: 1px solid #4a4f55; background: transparent; color: inherit; cursor: pointer; }
  #cancel:hover { background: #2a2e33; }
</style>
</head>
<body>
  <h1>Choose what to share</h1>
  <div class="grid">${cards}</div>
  <div class="actions"><button id="cancel">Cancel</button></div>
  <script>
    const { ipcRenderer } = require('electron')
    document.querySelectorAll('.source').forEach((el) => {
      el.addEventListener('click', () => ipcRenderer.send('${channel}', el.dataset.id))
    })
    document.getElementById('cancel').addEventListener('click', () => ipcRenderer.send('${channel}', null))
  </script>
</body>
</html>`
}

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

    /**
     * Slack's huddle/recording "share screen" button calls
     * `navigator.mediaDevices.getDisplayMedia()`. Without a display-media
     * request handler Electron silently drops that request, so the button does
     * nothing and Slack reports `content-share-connectivity=Failed`. We answer
     * the request by letting the user pick a screen or window.
     */
    Main.mainWindow.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
      Main.pickScreenShareSource()
        .then((source) => callback(source ? { video: source } : {}))
        .catch(() => callback({}))
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

  /**
   * Enumerate the available screens/windows and let the user choose one in a
   * small modal picker. Resolves with the chosen source, or null if there is
   * nothing to capture or the user cancels. (On Wayland, capture goes through
   * the xdg-desktop-portal, which may surface its own picker as well.)
   */
  private static pickScreenShareSource(): Promise<Electron.DesktopCapturerSource | null> {
    return desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } })
      .then((sources) => {
        if (sources.length === 0) return null

        return new Promise<Electron.DesktopCapturerSource | null>((resolve) => {
          const picker = new BrowserWindow({
            parent: Main.mainWindow ?? undefined,
            modal: true,
            width: 760,
            height: 600,
            title: 'Choose what to share',
            autoHideMenuBar: true,
            webPreferences: {
              contextIsolation: false,
              nodeIntegration: true,
              sandbox: false,
            },
          })

          let settled = false
          const finish = (id: string | null) => {
            if (settled) return
            settled = true
            ipcMain.removeListener(SlackyEvent.ScreenShareSourceSelected, onSelected)
            const chosen = id ? sources.find((source) => source.id === id) ?? null : null
            if (!picker.isDestroyed()) picker.close()
            resolve(chosen)
          }
          const onSelected = (_event: Electron.IpcMainEvent, id: string | null) => finish(id)

          ipcMain.on(SlackyEvent.ScreenShareSourceSelected, onSelected)
          // Closing the window (e.g. via the title bar) counts as a cancel.
          picker.on('closed', () => finish(null))

          const html = buildScreenSharePickerHtml(sources, SlackyEvent.ScreenShareSourceSelected)
          picker.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        })
      })
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
