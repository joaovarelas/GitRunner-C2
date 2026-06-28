<script setup lang="ts">
import { ref, computed } from 'vue'
import { store } from '../../store'
import { gl } from '../../api/gitlab'
import { runJob } from '../../lib/jobs'
import { tabs as invTabs } from '../../lib/tabs'
import SummaryTab from './SummaryTab.vue'
import DataTab from './DataTab.vue'
import Terminal from './Terminal.vue'
import FileManager from './FileManager.vue'

const r = store.runner!
const name = r.description || 'runner-' + r.id
const tag = r.tag_list?.[0] || ''

// Top tabs: Summary + the inventory/audit tabs (System, Hardware, Software,
// Security, Audit) + the tools (Terminal, Files).
const topTabs = [
  { id: 'summary', label: 'Summary' },
  ...invTabs.map((t) => ({ id: t.id, label: t.label })),
  { id: 'files', label: 'Filemanager' },
  { id: 'terminal', label: 'Terminal' },
]
const active = ref('summary')
const dataTab = computed(() => invTabs.find((t) => t.id === active.value))

const menuOpen = ref(false)
const actionMsg = ref('')

const powerActions = [
  { label: 'Restart', cmd: "shutdown /r /t 5 /c 'GitRunner C2 restart'", confirm: `Restart ${name}? It reboots in 5s.` },
  { label: 'Shutdown', cmd: "shutdown /s /t 5 /c 'GitRunner C2 shutdown'", confirm: `Shut down ${name}? It powers off in 5s.` },
]

async function power(action: (typeof powerActions)[number]) {
  menuOpen.value = false
  if (!window.confirm(action.confirm) || !store.project) return
  actionMsg.value = `${action.label}: sending…`
  try {
    const { status } = await runJob(store.project.id, tag, action.cmd)
    actionMsg.value = `${action.label}: ${status}`
  } catch (e: any) {
    actionMsg.value = `${action.label}: ${e.message}`
  }
  setTimeout(() => (actionMsg.value = ''), 6000)
}

async function cancelJobs() {
  menuOpen.value = false
  actionMsg.value = 'Cancelling jobs…'
  try {
    const [running, pending] = await Promise.all([
      gl.runnerJobs(r.id, 'running'),
      gl.runnerJobs(r.id, 'pending'),
    ])
    const all = [...running, ...pending]
    if (!all.length) { actionMsg.value = 'No active jobs.'; setTimeout(() => (actionMsg.value = ''), 4000); return }
    await Promise.all(all.map((j) => gl.cancelJob(j.project.id, j.id)))
    actionMsg.value = `Cancelled ${all.length} job(s).`
  } catch (e: any) {
    actionMsg.value = `Cancel failed: ${e.message}`
  }
  setTimeout(() => (actionMsg.value = ''), 6000)
}

async function unenroll() {
  menuOpen.value = false
  if (!window.confirm(`Remove ${name} from this project? This cannot be undone.`)) return
  actionMsg.value = 'Removing…'
  try {
    await gl.deleteRunner(r.id)
    store.runner = null
  } catch (e: any) {
    actionMsg.value = `Remove failed: ${e.message}`
    setTimeout(() => (actionMsg.value = ''), 6000)
  }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- header -->
    <div class="flex items-center gap-3 px-5 h-14 shrink-0 border-b border-zinc-200 dark:border-zinc-800">
      <button class="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" @click="store.runner = null">
        ← endpoints
      </button>
      <span class="h-2.5 w-2.5 rounded-full" :class="r.online ? 'bg-green-500' : 'bg-zinc-400 dark:bg-zinc-600'"></span>
      <span class="font-medium">{{ name }}</span>
      <span class="text-xs text-zinc-500">[{{ tag }}]</span>
      <span v-if="actionMsg" class="ml-2 text-xs text-zinc-500">{{ actionMsg }}</span>

      <div class="ml-auto relative">
        <button
          class="text-sm px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          @click="menuOpen = !menuOpen"
        >
          Actions ▾
        </button>
        <div v-if="menuOpen" class="fixed inset-0 z-10" @click="menuOpen = false"></div>
        <div
          v-if="menuOpen"
          class="absolute right-0 mt-1 w-44 z-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg py-1"
        >
          <div class="px-3 py-1 text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Power</div>
          <button
            v-for="a in powerActions"
            :key="a.label"
            class="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            @click="power(a)"
          >
            {{ a.label }}
          </button>
          <div class="my-1 border-t border-zinc-200 dark:border-zinc-700"></div>
          <button
            class="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            @click="cancelJobs"
          >
            Cancel Jobs
          </button>
          <div class="my-1 border-t border-zinc-200 dark:border-zinc-700"></div>
          <button
            class="w-full text-left px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            @click="unenroll"
          >
            Unenroll Endpoint
          </button>
        </div>
      </div>
    </div>

    <!-- top tab bar -->
    <nav class="flex gap-1 px-3 shrink-0 border-b border-zinc-200 dark:border-zinc-800 overflow-x-auto">
      <button
        v-for="t in topTabs"
        :key="t.id"
        class="px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors"
        :class="
          active === t.id
            ? 'border-green-600 text-zinc-900 dark:border-green-500 dark:text-zinc-100'
            : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
        "
        @click="active = t.id"
      >
        {{ t.label }}
      </button>
    </nav>

    <!-- content -->
    <div class="flex-1 min-h-0">
      <SummaryTab v-if="active === 'summary'" />
      <Terminal v-else-if="active === 'terminal'" />
      <FileManager v-else-if="active === 'files'" />
      <DataTab v-else-if="dataTab" :key="dataTab.id" :tab="dataTab" />
    </div>
  </div>
</template>
