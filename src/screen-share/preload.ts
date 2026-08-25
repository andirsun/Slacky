import { contextBridge, ipcRenderer } from 'electron'
import { SlackyEvent } from '../events'

/** One capturable screen or window, as rendered by the picker. */
export interface ScreenShareSource {
  id: string
  name: string
  /** PNG data URL of the source's thumbnail. */
  thumbnail: string
}

/**
 * Bridge for the screen-share picker window (picker.html). The source list is
 * pulled over IPC after the window is up rather than being baked into the page,
 * so the picker stays a fixed-size static asset no matter how many windows are
 * open — see the note in picker.ts.
 */
contextBridge.exposeInMainWorld('slackyScreenShare', {
  getSources: (): Promise<ScreenShareSource[]> =>
    ipcRenderer.invoke(SlackyEvent.ScreenShareSourcesRequested),
  select: (id: string | null): void => ipcRenderer.send(SlackyEvent.ScreenShareSourceSelected, id)
})
