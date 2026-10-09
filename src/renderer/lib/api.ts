import type { HootApi } from '../../shared/ipc'

declare global {
  interface Window {
    hoot: HootApi
  }
}

export const api: HootApi = window.hoot
