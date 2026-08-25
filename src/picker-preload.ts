import { contextBridge, ipcRenderer } from 'electron'
import { SlackyEvent } from './events'

/** One capturable screen or window, as rendered by the picker. */
export interface ScreenShareSource {
  id: string
  name: string
  /** PNG data URL of the source's thumbnail. */
  thumbnail: string
}

/**
 * Bridge for the screen-share picker window. The source list is pulled over
 * IPC after the window is up instead of being baked into its markup, which
 * kept the picker's own URL small enough for Chromium to load. See the note on
 * SCREEN_SHARE_PICKER_HTML in main.ts.
 */
contextBridge.exposeInMainWorld('slackyScreenShare', {
  getSources: (): Promise<ScreenShareSource[]> =>
    ipcRenderer.invoke(SlackyEvent.ScreenShareSourcesRequested),
  select: (id: string | null): void => ipcRenderer.send(SlackyEvent.ScreenShareSourceSelected, id)
})
