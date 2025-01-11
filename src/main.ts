import { BrowserWindow, shell, Session, OnBeforeSendHeadersListenerDetails, BeforeSendResponse } from 'electron'
import enhanceWebRequest from 'electron-better-web-request'

// TODO: Fix this hacky way to get around Slack's user agent check
export const defaultUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

export const enhanceSession = (session: Session) => {
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
        nodeIntegration: true
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
      userAgent: defaultUserAgent
    })
   
    Main.mainWindow.on('closed', Main.onClose)
  }

  static main(app: Electron.App, browserWindow: typeof BrowserWindow) {
    Main.BrowserWindow = browserWindow
    Main.application = app
    Main.application.on('window-all-closed', Main.onWindowAllClosed)
    Main.application.on('ready', Main.onReady)

    app.on('session-created', (session) => {
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
