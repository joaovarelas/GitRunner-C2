<script setup lang="ts">
import { ref } from 'vue'
import { store } from '../../store'
import { runJob, runJsonArray, uploadAndRun } from '../../lib/jobs'
import { useCachedJson } from '../../lib/useCachedJson'
import DataTable from '../DataTable.vue'
import type { Column } from '../../lib/tabs'

const pid = store.project!.id
const tag = store.runner!.tag_list?.[0] || ''

const columns: Column[] = [
  { key: 'Name', label: 'Name' },
  { key: 'DisplayName', label: 'Display name', truncate: true },
  { key: 'State', label: 'State' },
  { key: 'StartMode', label: 'Start mode' },
  { key: 'PathName', label: 'Path', mono: true, truncate: true },
]

const LIST_CMD =
  'Get-CimInstance Win32_SystemDriver | ' +
  'Select-Object Name, DisplayName, State, StartMode, PathName | ' +
  'Sort-Object Name | ConvertTo-Json -Compress'

const {
  data: driversData,
  loading,
  error,
  refresh: refreshDrivers,
} = useCachedJson<Record<string, any>[]>(
  () => (store.runner ? `drivers:${store.runner.id}` : null),
  () => runJsonArray(pid, tag, LIST_CMD),
)

const drivers = driversData

// Row actions
const actingRow = ref<Record<string, any> | null>(null)
const actingAction = ref('')

async function rowAction(row: Record<string, any>, action: 'start' | 'stop' | 'remove') {
  const name = row.Name
  const confirms: Record<string, string> = {
    start: `Start driver "${name}"?`,
    stop: `Stop driver "${name}"?`,
    remove: `Remove driver "${name}"? This deletes the service entry.`,
  }
  const commands: Record<string, string> = {
    start: `Start-Service -Name "${name}"`,
    stop: `Stop-Service -Name "${name}" -Force`,
    remove: `sc.exe delete "${name}"`,
  }
  if (!window.confirm(confirms[action])) return
  actingRow.value = row
  actingAction.value = action
  try {
    const { status, output } = await runJob(pid, tag, commands[action])
    if (status === 'success') await refreshDrivers()
    else window.alert(output || `action failed: ${status}`)
  } catch (e: any) {
    window.alert(e.message)
  } finally {
    actingRow.value = null
    actingAction.value = ''
  }
}

// Install panel
const showInstall = ref(false)
const installFile = ref<File | null>(null)
const serviceName = ref('')
const destPath = ref('')
const startAfter = ref(false)
const installing = ref(false)
const installStatus = ref('')

function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] || null
  installFile.value = f
  if (f) {
    if (!serviceName.value) serviceName.value = f.name.replace(/\.sys$/i, '')
    if (!destPath.value) destPath.value = `C:\\Windows\\System32\\drivers\\${f.name}`
  }
}

function closeInstall() {
  showInstall.value = false
  installFile.value = null
  serviceName.value = ''
  destPath.value = ''
  startAfter.value = false
  installStatus.value = ''
}

// Escape a value for use inside a PowerShell double-quoted string.
const psDQ = (s: string) => s.replace(/[`"$]/g, '`$&')

async function install() {
  if (!installFile.value || !serviceName.value || !destPath.value) return
  installing.value = true
  installStatus.value = ''
  const name = psDQ(serviceName.value)
  const dest = psDQ(destPath.value)
  const doStart = startAfter.value
  try {
    const { status, output } = await uploadAndRun(
      pid,
      tag,
      installFile.value,
      (fileUrl) =>
        `Invoke-WebRequest -Uri "${fileUrl}" ` +
        `-Headers @{'JOB-TOKEN' = $env:CI_JOB_TOKEN} ` +
        `-OutFile "${dest}"\n` +
        `sc.exe create "${name}" type= kernel binPath= "${dest}"\n` +
        (doStart ? `Start-Service -Name "${name}"\n` : '') +
        'Write-Output "Done"',
      { onStatus: (msg) => { installStatus.value = msg } },
    )
    if (status === 'success') {
      closeInstall()
      await refreshDrivers()
    } else {
      installStatus.value = output || `failed: ${status}`
    }
  } catch (e: any) {
    installStatus.value = e.message
  } finally {
    installing.value = false
  }
}
</script>

<template>
  <div class="flex flex-col h-full">

    <!-- install panel -->
    <div
      v-if="showInstall"
      class="shrink-0 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 space-y-3 bg-zinc-50 dark:bg-zinc-900/50"
    >
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium">Install driver</span>
        <button
          class="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          @click="closeInstall"
        >
          ✕
        </button>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="col-span-2">
          <label class="block text-xs text-zinc-500 mb-1">Driver file (.sys)</label>
          <input type="file" accept=".sys" class="text-xs" @change="onFileChange" />
        </div>
        <div>
          <label class="block text-xs text-zinc-500 mb-1">Service name</label>
          <input
            v-model="serviceName"
            placeholder="mydriver"
            class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs outline-none focus:border-green-600"
          />
        </div>
        <div>
          <label class="block text-xs text-zinc-500 mb-1">Destination path</label>
          <input
            v-model="destPath"
            placeholder="C:\Windows\System32\drivers\mydriver.sys"
            class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs font-mono outline-none focus:border-green-600"
          />
        </div>
      </div>

      <div class="flex items-center gap-4">
        <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input v-model="startAfter" type="checkbox" />
          Start after install
        </label>
        <button
          class="text-xs bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded px-3 py-1.5"
          :disabled="installing || !installFile || !serviceName || !destPath"
          @click="install"
        >
          {{ installing ? 'Installing…' : 'Install' }}
        </button>
        <span v-if="installStatus" class="text-xs text-zinc-500 truncate max-w-xs">{{ installStatus }}</span>
      </div>
    </div>

    <!-- toolbar -->
    <div
      v-if="!showInstall"
      class="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800"
    >
      <button
        class="text-xs bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded px-2.5 py-1"
        @click="showInstall = true"
      >
        + Install driver
      </button>
    </div>

    <!-- driver list -->
    <div class="flex-1 min-h-0">
      <DataTable :columns="columns" :rows="drivers || []" :loading="loading" :error="error" @refresh="refreshDrivers">
        <template #actions="{ row }">
          <div class="flex justify-end gap-1.5">
            <button
              class="text-xs px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
              :disabled="actingRow !== null"
              @click="rowAction(row, 'start')"
            >
              {{ actingRow === row && actingAction === 'start' ? '…' : 'start' }}
            </button>
            <button
              class="text-xs px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
              :disabled="actingRow !== null"
              @click="rowAction(row, 'stop')"
            >
              {{ actingRow === row && actingAction === 'stop' ? '…' : 'stop' }}
            </button>
            <button
              class="text-xs px-2 py-0.5 rounded border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-40"
              :disabled="actingRow !== null"
              @click="rowAction(row, 'remove')"
            >
              {{ actingRow === row && actingAction === 'remove' ? '…' : 'remove' }}
            </button>
          </div>
        </template>
      </DataTable>
    </div>

  </div>
</template>
