const { app, BrowserWindow } = require('electron')
const path = require('path')

const createWindow = () => {
  const win = new BrowserWindow({
    roundedCorners: true,
    width: 1920,
    height: 1080,
    title: 'Slack ARM',
    center: true,
    icon: process.platform === 'linux' ? path.join(__dirname, 'resources/icons/icon.png') : undefined,
    webPreferences: {
      nativeWindowOpen: true,
      nodeIntegration: true
    }
  })

  win.loadURL('https://app.slack.com/client', {
    // TODO: Fix Hacky way to get around Slack's user agent check
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.6099.71 Safari/537.36'
  })
}

app.whenReady().then(() => {
  createWindow()
})