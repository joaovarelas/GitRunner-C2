import { reactive } from 'vue'
import type { Project, Runner } from './api/gitlab'

type Theme = 'light' | 'dark'

// Minimal shared state. Auth + theme are persisted to localStorage; selection
// is in-memory. There is no backend and no database -- GitLab holds everything.
export const store = reactive({
  gitlabUrl: localStorage.getItem('gl_url') || 'https://gitlab.com',
  token: localStorage.getItem('gl_token') || '',
  theme: (localStorage.getItem('gl_theme') as Theme) || 'dark',
  project: null as Project | null,
  runner: null as Runner | null,
})

export function saveAuth(url: string, token: string) {
  store.gitlabUrl = url.replace(/\/$/, '')
  store.token = token
  localStorage.setItem('gl_url', store.gitlabUrl)
  localStorage.setItem('gl_token', token)
}

export function logout() {
  store.token = ''
  store.project = null
  store.runner = null
  localStorage.removeItem('gl_token')
}

export function applyTheme() {
  document.documentElement.classList.toggle('dark', store.theme === 'dark')
}

export function toggleTheme() {
  store.theme = store.theme === 'dark' ? 'light' : 'dark'
  localStorage.setItem('gl_theme', store.theme)
  applyTheme()
}
