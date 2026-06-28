<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { store } from '../../store'
import { runJob } from '../../lib/jobs'

const host = ref<HTMLDivElement>()
const shell = ref<'powershell' | 'cmd'>('powershell')
let term: Terminal
let fit: FitAddon
let line = ''
let busy = false

// ANSI: green / brightBlack(dim) / red / reset. Actual colors come from the
// xterm theme below, so they stay readable in both light and dark mode.
const G = '\x1b[32m', D = '\x1b[90m', R = '\x1b[31m', X = '\x1b[0m'

const tag = store.runner!.tag_list![0]
const name = store.runner!.description || 'runner-' + store.runner!.id

const themes = {
  dark: {
    background: '#0b0b0e',
    foreground: '#d4d4d8',
    cursor: '#d4d4d8',
    green: '#4ade80',
    red: '#f87171',
    brightBlack: '#71717a',
    selectionBackground: '#3f3f46',
  },
  light: {
    background: '#fcfcfd',
    foreground: '#3f3f46',
    cursor: '#3f3f46',
    green: '#15803d',
    red: '#dc2626',
    brightBlack: '#a1a1aa',
    selectionBackground: '#e4e4e7',
  },
}

function promptStr() {
  return shell.value === 'cmd' ? `${G}C:\\>${X} ` : `${G}PS ${name}>${X} `
}
function prompt() {
  term.write('\r\n' + promptStr())
}

async function run(raw: string) {
  busy = true
  // Both shells run inside the powershell executor; for cmd we wrap the call.
  const cmd = shell.value === 'cmd' ? `cmd /c ${raw}` : raw
  try {
    term.writeln(`${D}• queuing job…${X}`)
    const { status } = await runJob(store.project!.id, tag, cmd, {
      onStatus: (m) => term.writeln(`${D}• ${m}${X}`),
      onChunk: (delta) => term.write(delta.replace(/\n/g, '\r\n')),
    })
    term.writeln(`\r\n${status === 'success' ? D : R}• ${status}${X}`)
  } catch (e: any) {
    term.writeln(`\r\n${R}${e.message}${X}`)
  } finally {
    busy = false
    prompt()
  }
}

function onResize() {
  try {
    fit.fit()
  } catch {
    /* ignore */
  }
}

watch(
  () => store.theme,
  (t) => {
    if (term) term.options.theme = themes[t]
  },
)

// Redraw the prompt in place when the shell is toggled (unless mid-command).
watch(shell, () => {
  if (!term || busy) return
  line = ''
  term.write('\r\x1b[2K' + promptStr())
})

onMounted(() => {
  term = new Terminal({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 14,
    cursorBlink: true,
    theme: themes[store.theme],
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host.value!)
  fit.fit()

  term.writeln(`${D}endpoint ${name} [${tag}] — each command runs as a GitLab CI job.${X}`)
  prompt()

  term.onData((d) => {
    if (busy) return
    const code = d.charCodeAt(0)
    if (d === '\r') {
      const cmd = line
      line = ''
      term.write('\r\n')
      if (cmd.trim()) void run(cmd)
      else prompt()
    } else if (code === 127 || code === 8) {
      if (line) {
        line = line.slice(0, -1)
        term.write('\b \b')
      }
    } else if (code === 3) {
      line = ''
      term.write('^C')
      prompt()
    } else if (d >= ' ') {
      line += d
      term.write(d)
    }
  })

  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  term?.dispose()
})
</script>

<template>
  <div class="flex flex-col h-full">
    <div
      class="flex items-center gap-2 px-4 py-2 shrink-0 border-b border-zinc-200 dark:border-zinc-800"
    >
      <span class="text-xs text-zinc-500">shell:</span>
      <div class="flex rounded border border-zinc-300 dark:border-zinc-700 overflow-hidden text-xs">
        <button
          v-for="s in ['powershell', 'cmd']"
          :key="s"
          class="px-2.5 py-1"
          :class="
            shell === s
              ? 'bg-green-600 text-white'
              : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          "
          @click="shell = s as 'powershell' | 'cmd'"
        >
          {{ s }}
        </button>
      </div>
    </div>
    <div ref="host" class="flex-1 min-h-0 p-2 bg-[#fcfcfd] dark:bg-[#0b0b0e]"></div>
  </div>
</template>
