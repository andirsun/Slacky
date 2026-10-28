import { Session, OnBeforeSendHeadersListenerDetails, BeforeSendResponse } from 'electron'

/**
 * Slack serves a degraded client to user agents it does not recognise, so every
 * session claims to be desktop Chrome on Linux.
 */
export const defaultUserAgent =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

/**
 * Pin the user agent for a session, on the session itself and on every outgoing
 * request. Setting it in both places matters: `setUserAgent` alone is not
 * applied to requests Slack's service worker and sub-resources make.
 */
export const enhanceSession = (session: Session) => {
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
