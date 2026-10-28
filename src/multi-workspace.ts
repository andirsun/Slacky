/**
 * Slack's web client already ships the desktop app's workspace switcher: the
 * rail of workspace icons with unread dots and mention badges, left of the
 * Home / DMs / Activity tabs. It only renders it in "multi-team" mode, which
 * the web client enables for the desktop app and ChromeOS and otherwise leaves
 * off, so on a plain Chrome-on-Linux user agent only the active workspace is
 * booted and the rail stays hidden.
 *
 * Slack honours an override for that check in its own local config
 * (`localConfig_v2.multiTeamOverride`, read by `detectMultiTeamCapable()`).
 * Setting it before Slack boots makes it load every signed-in workspace in the
 * one window and show the native switcher, with no user agent spoofing (a
 * desktop "Slack/x.y" user agent makes the client wait for the official app's
 * IPC bridge and fail to load).
 *
 * The rail itself is a collapsible panel whose state Slack keeps in
 * `localConfig_v2.viewLayoutIsWorkspaceSwitcherVisible`; unset means hidden, so
 * on a fresh profile the rail would start collapsed. It is defaulted to visible
 * so every signed-in workspace is in view from the first launch.
 *
 * Only unset values are touched, so an explicit `false` is respected for both:
 * hiding the rail (Ctrl+Shift+S) sticks, and multi-team mode can be opted out of.
 */
const LOCAL_CONFIG_KEY = 'localConfig_v2'

export const enableMultiWorkspace = () => {
  if (window.location.hostname !== 'app.slack.com') return

  try {
    const raw = window.localStorage.getItem(LOCAL_CONFIG_KEY)
    const config = raw ? JSON.parse(raw) : {}
    if (config.multiTeamOverride === undefined) config.multiTeamOverride = true
    if (config.multiTeamOverride !== true) return

    config.viewLayoutIsWorkspaceSwitcherVisible ??= true
    window.localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config))
  } catch {
    // Never block Slack from booting over this; it just falls back to the
    // single-workspace web layout.
  }
}
