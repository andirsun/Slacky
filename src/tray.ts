import { app, Menu, nativeImage, Tray } from 'electron'
import * as path from 'path'

/**
 * Pixel size handed to the StatusNotifierItem pixmap. The source icon is
 * 512px; Plasma's tray host is happier with a modest ARGB pixmap than with
 * the full image on the session bus.
 */
const TRAY_ICON_PX = 128

/**
 * Slacky's window and tray icon. `app.getAppPath()` is the project root under
 * `electron .` and the asar root in a packaged build, where electron-builder
 * places `build/icons/icon.png`.
 */
export const slackyIcon = () => {
  const iconPath = path.join(app.getAppPath(), 'build/icons/icon.png')
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    throw new Error(`Slacky icon is missing or unreadable: ${iconPath}`)
  }
  return image
}

/**
 * Register a system tray icon.
 *
 * On Linux, Electron's `Tray` is a StatusNotifierItem. KDE Plasma hosts that
 * protocol on `org.kde.StatusNotifierWatcher`, so the icon shows up in the
 * Plasma system tray without libappindicator. Left click emits `click`
 * (`Activate`); right click opens the menu through dbusmenu. "Show Slacky"
 * is also in the menu for hosts that deliver the primary click as a menu
 * instead of `Activate`.
 *
 * The returned `Tray` must be retained. Electron destroys it if the object
 * is garbage-collected, and the icon disappears.
 */
export const createTray = (present: () => void, quit: () => void) => {
  const tray = new Tray(slackyIcon().resize({ width: TRAY_ICON_PX, height: TRAY_ICON_PX }))
  tray.setToolTip('Slacky')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Slacky', click: present },
      { type: 'separator' },
      { label: 'Quit Slacky', click: quit }
    ])
  )
  tray.on('click', present)
  return tray
}
