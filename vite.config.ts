import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// Dev server proxies /gitlab/* to your GitLab instance so the browser stays
// same-origin (no CORS). Override the target with GITLAB_URL in a .env file.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.GITLAB_URL || 'https://gitlab.com'
  return {
    plugins: [vue()],
    server: {
      proxy: {
        '/gitlab': {
          target,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/gitlab/, ''),
        },
      },
    },
  }
})
