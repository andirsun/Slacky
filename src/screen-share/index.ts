import { BrowserWindow, Session, webContents } from 'electron'
import { pickScreenShareSource } from './picker'

/**
 * Resolve the window that issued a `getDisplayMedia()` request. Slack can pop a
 * huddle out into its own window, and parenting the modal picker to the main
 * window instead of the requesting one leaves it attached to a background
 * window — which on Linux makes the two windows fight over focus and the picker
 * flicker in and out.
 */
const windowForRequest = (
  request: Electron.DisplayMediaRequestHandlerHandlerRequest,
  fallback: Electron.BrowserWindow | null
): Electron.BrowserWindow | null => {
  const frame = request.frame
  if (!frame) return fallback

  const contents = webContents.fromFrame(frame.top ?? frame)
  return (contents ? BrowserWindow.fromWebContents(contents) : null) ?? fallback
}

/**
 * Answer Slack's screen-share requests for a session.
 *
 * Slack's huddle/recording "share screen" button calls
 * `navigator.mediaDevices.getDisplayMedia()`. Without a display-media request
 * handler Electron silently drops that request, so the button does nothing and
 * Slack reports `content-share-connectivity=Failed`. We answer it by letting
 * the user pick a screen or window.
 *
 * `fallbackWindow` is read lazily: it parents the picker when the requesting
 * window cannot be resolved, and the main window is replaced over the app's
 * lifetime.
 */
export const registerScreenShareHandler = (
  session: Session,
  fallbackWindow: () => Electron.BrowserWindow | null
) => {
  session.setDisplayMediaRequestHandler((request, callback) => {
    pickScreenShareSource(windowForRequest(request, fallbackWindow()))
      .then((source) => callback(source ? { video: source } : {}))
      .catch(() => callback({}))
  })
}
