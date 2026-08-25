import {
  BrowserWindow,
  shell,
  Session,
  OnBeforeSendHeadersListenerDetails,
  BeforeSendResponse,
  ipcMain,
  desktopCapturer,
  webContents
} from 'electron'
import * as path from 'path'
import { SlackyEvent } from './events'

const defaultUserAgent =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

const PICKER_THUMBNAIL_SIZE = { width: 320, height: 180 }

/**
 * Static shell for the screen-share picker. The sources are fetched over IPC
 * once the window is up rather than being interpolated into this markup:
 * Chromium caps URL length, so a `data:` URL carrying every thumbnail fails to
 * load once it reaches a couple of megabytes (`ERR_INVALID_URL`). At roughly
 * 32 KB per encoded 320x180 thumbnail, a desktop with a few dozen open windows
 * gets there on its own — and when it did, the picker came up as an empty
 * black window that silently swallowed the share request.
 */
const SCREEN_SHARE_PICKER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Choose what to share</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; background: #1a1d21; color: #e8e8e8; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .source { display: flex; flex-direction: column; gap: 8px; padding: 8px; background: #222529; border: 2px solid transparent; border-radius: 8px; cursor: pointer; color: inherit; text-align: left; font: inherit; }
  .source:hover, .source:focus-visible { border-color: #1264a3; background: #2a2e33; outline: none; }
  .source img { width: 100%; height: 124px; object-fit: cover; background: #000; border-radius: 4px; }
  .source span { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty { font-size: 14px; color: #9aa0a6; }
  .actions { margin-top: 20px; text-align: right; }
  #cancel { padding: 8px 18px; font-size: 14px; border-radius: 6px; border: 1px solid #4a4f55; background: transparent; color: inherit; cursor: pointer; }
  #cancel:hover { background: #2a2e33; }
</style>
</head>
<body>
  <h1>Choose what to share</h1>
  <div class="grid" id="grid"></div>
  <div class="actions"><button id="cancel">Cancel</button></div>
  <script>
    const cancel = () => window.slackyScreenShare.select(null)

    const render = (sources) => {
      const grid = document.getElementById('grid')
      if (sources.length === 0) {
        grid.className = 'empty'
        grid.textContent = 'No screens or windows are available to share.'
        return
      }
      for (const source of sources) {
        const card = document.createElement('button')
        card.className = 'source'
        const thumbnail = document.createElement('img')
        thumbnail.src = source.thumbnail
        thumbnail.alt = ''
        const label = document.createElement('span')
        // textContent, not innerHTML: window titles are attacker-influenced.
        label.textContent = source.name
        label.title = source.name
        card.append(thumbnail, label)
        card.addEventListener('click', () => window.slackyScreenShare.select(source.id))
        grid.append(card)
      }
      grid.firstElementChild.focus()
    }

    window.slackyScreenShare.getSources().then(render).catch(cancel)
    document.getElementById('cancel').addEventListener('click', cancel)
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') cancel()
    })
  </script>
</body>
</html>`

const enhanceSession = (session: Session) => {
  session.setUserAgent(defaultUserAgent)
  session.webRequest.onBeforeSendHeaders(
    (
      details: OnBeforeSendHeadersListenerDetails,
      callback: (beforeSendResponse: BeforeSendResponse) => void
    ) => {
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
 * to Slack or a supported authentication provider. Internal targets — most
 * importantly `about:blank`, which Slack uses when it pops a huddle out via
 * `window.open()` and then drives the returned window itself — must stay inside
 * Electron.
 */
const isExternalUrl = (url: string): boolean => {
  if (!/^https?:\/\//i.test(url)) return false

  try {
    const { hostname } = new URL(url)
    const isSlack = hostname === 'slack.com' || hostname.endsWith('.slack.com')
    const isGoogleAuth = hostname === 'accounts.google.com'
    return !isSlack && !isGoogleAuth
  } catch {
    return true
  }
}

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
  /** The screen-share picker, while one is open. At most one exists at a time. */
  private static screenSharePicker: Electron.BrowserWindow | null = null

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

    /**
     * Slack's huddle/recording "share screen" button calls
     * `navigator.mediaDevices.getDisplayMedia()`. Without a display-media
     * request handler Electron silently drops that request, so the button does
     * nothing and Slack reports `content-share-connectivity=Failed`. We answer
     * the request by letting the user pick a screen or window.
     */
    Main.mainWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
      Main.pickScreenShareSource(Main.windowForRequest(request))
        .then((source) => callback(source ? { video: source } : {}))
        .catch(() => callback({}))
    })

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

  /**
   * Resolve the window that issued a `getDisplayMedia()` request. Slack can pop
   * a huddle out into its own window, and parenting the modal picker to the
   * main window instead of the requesting one leaves it attached to a
   * background window — which on Linux makes the two windows fight over focus
   * and the picker flicker in and out.
   */
  private static windowForRequest(
    request: Electron.DisplayMediaRequestHandlerHandlerRequest
  ): Electron.BrowserWindow | null {
    const frame = request.frame
    if (!frame) return Main.mainWindow

    const contents = webContents.fromFrame(frame.top ?? frame)
    return (contents ? BrowserWindow.fromWebContents(contents) : null) ?? Main.mainWindow
  }

  /**
   * Enumerate the available screens/windows and let the user choose one in a
   * small modal picker. Resolves with the chosen source, or null if there is
   * nothing to capture or the user cancels. (On Wayland, capture goes through
   * the xdg-desktop-portal, which may surface its own picker as well.)
   */
  private static pickScreenShareSource(
    parent: Electron.BrowserWindow | null
  ): Promise<Electron.DesktopCapturerSource | null> {
    // Slack re-issues `getDisplayMedia()` while an earlier request is still
    // pending. Stacking a second modal picker on top of the first made the
    // window flicker in and out, and both pickers listened on the same IPC
    // channel so a single click resolved them all; a repeat request now just
    // raises the picker that is already open.
    const open = Main.screenSharePicker
    if (open && !open.isDestroyed()) {
      open.focus()
      return Promise.resolve(null)
    }

    return desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: PICKER_THUMBNAIL_SIZE })
      .then((sources) => {
        if (sources.length === 0) return null

        return new Promise<Electron.DesktopCapturerSource | null>((resolve) => {
          const picker = new BrowserWindow({
            parent: parent ?? undefined,
            modal: parent !== null,
            // Stay hidden until the renderer has painted; showing the window
            // straight away is what made it flash up empty and black.
            show: false,
            width: 760,
            height: 600,
            title: 'Choose what to share',
            backgroundColor: '#1a1d21',
            autoHideMenuBar: true,
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: false,
              preload: path.join(__dirname, 'picker-preload.js')
            }
          })
          Main.screenSharePicker = picker

          let settled = false
          const finish = (id: string | null) => {
            if (settled) return
            settled = true
            ipcMain.removeHandler(SlackyEvent.ScreenShareSourcesRequested)
            ipcMain.removeListener(SlackyEvent.ScreenShareSourceSelected, onSelected)
            Main.screenSharePicker = null
            const chosen = id ? (sources.find((source) => source.id === id) ?? null) : null
            if (!picker.isDestroyed()) picker.close()
            resolve(chosen)
          }
          const onSelected = (event: Electron.IpcMainEvent, id: string | null) => {
            if (event.sender !== picker.webContents) return
            finish(id)
          }

          // Thumbnails travel over IPC rather than inside the picker's URL —
          // see the note on SCREEN_SHARE_PICKER_HTML.
          ipcMain.removeHandler(SlackyEvent.ScreenShareSourcesRequested)
          ipcMain.handle(SlackyEvent.ScreenShareSourcesRequested, () =>
            sources.map((source) => ({
              id: source.id,
              name: source.name,
              thumbnail: source.thumbnail.toDataURL()
            }))
          )
          ipcMain.on(SlackyEvent.ScreenShareSourceSelected, onSelected)

          picker.once('ready-to-show', () => picker.show())
          // Closing the window (e.g. via the title bar) counts as a cancel.
          picker.on('closed', () => finish(null))
          // Never leave the request hanging if the picker's renderer dies.
          picker.webContents.on('render-process-gone', () => finish(null))

          picker
            .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SCREEN_SHARE_PICKER_HTML))
            .catch(() => finish(null))
        })
      })
      .catch(() => null)
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
