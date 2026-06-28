import { createApp } from 'vue'
import App from './App.vue'
import { applyTheme } from './store'
import './style.css'
import '@xterm/xterm/css/xterm.css'

applyTheme()
createApp(App).mount('#app')
