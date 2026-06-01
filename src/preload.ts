import { ipcRenderer } from 'electron'

/**
 * Slack's web client raises desktop notifications through the HTML5
 * `window.Notification` API. When the user clicks one, Slack's own handler
 * calls `window.focus()` — but on Linux that request is routinely ignored by
 * the window manager for a backgrounded window, so the Slacky window never
 * comes forward.
 *
 * We wrap the `Notification` constructor so that every notification also tells
 * the main process (which CAN raise the window) when it is clicked. A Proxy on
 * the `construct` trap is used so all static members (`permission`,
 * `requestPermission`, etc.) and `instanceof` checks keep working untouched.
 *
 * This requires `contextIsolation: false` so the patch lands in the same
 * JavaScript context that Slack's page scripts read `Notification` from.
 */
const NativeNotification = window.Notification

if (NativeNotification) {
  window.Notification = new Proxy(NativeNotification, {
    construct(target, args: [string, NotificationOptions?]) {
      const notification = new target(...args)
      notification.addEventListener('click', () => {
        ipcRenderer.send('slacky:notification-clicked')
      })
      return notification
    }
  })
}
