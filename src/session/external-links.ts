import { shell } from 'electron'

/**
 * A URL is "external" only when it is a real http(s) link that does not belong
 * to Slack or a supported authentication provider. Internal targets — most
 * importantly `about:blank`, which Slack uses when it pops a huddle out via
 * `window.open()` and then drives the returned window itself — must stay inside
 * Electron.
 */
export const isExternalUrl = (url: string): boolean => {
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
export const applyExternalLinkPolicy = (contents: Electron.WebContents) => {
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
