/**
 * Slack's web client only follows the OS light/dark mode on macOS, Windows 10
 * and its own desktop app (`get_system_sync_is_enabled`); on a Linux browser,
 * which is what Slacky looks like, "Sync with OS setting" is not offered and
 * the client stays on its device theme (`localStorage['slack-client-theme']`,
 * "light" when unset). Slack reads that key once, at boot.
 *
 * So Slacky syncs it itself: before Slack boots, the key is set from
 * `prefers-color-scheme` (Electron takes it from the desktop's
 * `org.freedesktop.appearance color-scheme`), and when the system mode changes
 * the key is updated and Slack reloaded — deferred while a call or screen share
 * holds a live media track, so a huddle is never cut off.
 */
const THEME_KEY = 'slack-client-theme'
const OS_SYNC_KEY = 'slack-client-theme-os-sync'
const DARK_QUERY = '(prefers-color-scheme: dark)'
const RELOAD_RETRY_MS = 30_000

const liveTracks = new Set<MediaStreamTrack>()

const trackMedia = (method: 'getUserMedia' | 'getDisplayMedia') => {
  const devices = navigator.mediaDevices
  const original = devices?.[method]
  if (!original) return

  devices[method] = async function (this: MediaDevices, ...args: never[]) {
    const stream: MediaStream = await (original as (...a: never[]) => Promise<MediaStream>).apply(
      this,
      args
    )
    for (const track of stream.getTracks()) {
      liveTracks.add(track)
      track.addEventListener('ended', () => liveTracks.delete(track))
    }
    return stream
  } as MediaDevices[typeof method]
}

const isInCall = () => {
  for (const track of liveTracks) {
    if (track.readyState === 'live') return true
    liveTracks.delete(track)
  }
  return false
}

const writeTheme = (dark: boolean) => {
  const theme = dark ? 'dark' : 'light'
  if (window.localStorage.getItem(THEME_KEY) === theme) return false
  window.localStorage.setItem(THEME_KEY, theme)
  window.localStorage.setItem(OS_SYNC_KEY, 'true')
  return true
}

let reloadTimer: ReturnType<typeof setTimeout> | undefined

const reloadWhenIdle = () => {
  clearTimeout(reloadTimer)
  if (isInCall()) {
    reloadTimer = setTimeout(reloadWhenIdle, RELOAD_RETRY_MS)
    return
  }
  window.location.reload()
}

export const followSystemTheme = () => {
  if (window.location.hostname !== 'app.slack.com') return

  try {
    const query = window.matchMedia(DARK_QUERY)
    writeTheme(query.matches)

    trackMedia('getUserMedia')
    trackMedia('getDisplayMedia')

    query.addEventListener('change', (event) => {
      if (writeTheme(event.matches)) reloadWhenIdle()
    })
  } catch {
    // Never block Slack from booting over this; it keeps its own theme.
  }
}
