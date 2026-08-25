import { BrowserWindow, desktopCapturer, ipcMain } from 'electron'
import * as path from 'path'
import { SlackyEvent } from '../events'

const THUMBNAIL_SIZE = { width: 320, height: 180 }

/** The picker, while one is open. At most one exists at a time. */
let openPicker: Electron.BrowserWindow | null = null

/**
 * Enumerate the available screens/windows and let the user choose one in a
 * small modal picker. Resolves with the chosen source, or null if there is
 * nothing to capture or the user cancels. (On Wayland, capture goes through
 * the xdg-desktop-portal, which may surface its own picker as well.)
 */
export const pickScreenShareSource = (
  parent: Electron.BrowserWindow | null
): Promise<Electron.DesktopCapturerSource | null> => {
  // Slack re-issues `getDisplayMedia()` while an earlier request is still
  // pending. Stacking a second modal picker on top of the first made the window
  // flicker in and out, and both pickers listened on the same IPC channel so a
  // single click resolved them all; a repeat request now just raises the picker
  // that is already open.
  if (openPicker && !openPicker.isDestroyed()) {
    openPicker.focus()
    return Promise.resolve(null)
  }

  return desktopCapturer
    .getSources({ types: ['screen', 'window'], thumbnailSize: THUMBNAIL_SIZE })
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
            preload: path.join(__dirname, 'preload.js')
          }
        })
        openPicker = picker

        let settled = false
        const finish = (id: string | null) => {
          if (settled) return
          settled = true
          ipcMain.removeHandler(SlackyEvent.ScreenShareSourcesRequested)
          ipcMain.removeListener(SlackyEvent.ScreenShareSourceSelected, onSelected)
          openPicker = null
          const chosen = id ? (sources.find((source) => source.id === id) ?? null) : null
          if (!picker.isDestroyed()) picker.close()
          resolve(chosen)
        }
        const onSelected = (event: Electron.IpcMainEvent, id: string | null) => {
          if (event.sender !== picker.webContents) return
          finish(id)
        }

        // Thumbnails travel over IPC rather than being inlined into the page.
        // An earlier build interpolated them into a `data:` URL, but Chromium
        // caps URL length: at roughly 32 KB per encoded thumbnail a desktop
        // with a few dozen open windows pushed that URL past a couple of
        // megabytes, `loadURL` failed with `ERR_INVALID_URL`, and the picker
        // came up as an empty black window that swallowed the share request.
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

        picker.loadFile(path.join(__dirname, 'picker.html')).catch(() => finish(null))
      })
    })
    .catch(() => null)
}
