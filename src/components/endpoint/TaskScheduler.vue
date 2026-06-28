<script setup lang="ts">
import { ref, computed } from 'vue'
import { store } from '../../store'
import { runJob, runJsonArray } from '../../lib/jobs'
import { useCachedJson } from '../../lib/useCachedJson'
import DataTable from '../DataTable.vue'
import type { Column } from '../../lib/tabs'

interface Task {
  Name: string
  Path: string
  State: string
  Triggers: string
  Command: string
  LastRun: string
  NextRun: string
}

const pid = store.project!.id
const tag = store.runner!.tag_list?.[0] || ''

// PS-escape a value for use inside a double-quoted string.
const psDQ = (s: string) => s.replace(/[`"$]/g, '`$&')

// Multi-line script: file-type CI variable writes it to disk and runs it as .ps1
const LIST_CMD = `Get-ScheduledTask | ForEach-Object {
  $info = $_ | Get-ScheduledTaskInfo -ErrorAction SilentlyContinue
  [PSCustomObject]@{
    Name     = $_.TaskName
    Path     = $_.TaskPath
    State    = [string]$_.State
    Triggers = (($_.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace 'MSFT_Task','' -replace 'Trigger','' }) -join ', ')
    Command  = (($_.Actions | ForEach-Object { if($_.Execute){ ("$($_.Execute) $($_.Arguments)").Trim() }else{ '[COM]' } }) -join '; ')
    LastRun  = if($info -and $info.LastRunTime  -and $info.LastRunTime.Year  -gt 1999){ $info.LastRunTime.ToString('yyyy-MM-dd HH:mm')  }else{''}
    NextRun  = if($info -and $info.NextRunTime  -and $info.NextRunTime.Year  -gt 1999){ $info.NextRunTime.ToString('yyyy-MM-dd HH:mm')  }else{''}
  }
} | Sort-Object Path, Name | ConvertTo-Json -Compress`

const columns: Column[] = [
  { key: 'Path',     label: 'Path',    mono: true, truncate: true },
  { key: 'Name',     label: 'Name',               truncate: true },
  { key: 'State',    label: 'State' },
  { key: 'Triggers', label: 'Trigger',             truncate: true },
  { key: 'Command',  label: 'Command', mono: true, truncate: true },
  { key: 'LastRun',  label: 'Last run' },
  { key: 'NextRun',  label: 'Next run' },
]

const { data: tasks, loading, error, refresh } = useCachedJson<Task[]>(
  () => (store.runner ? `taskscheduler:${store.runner.id}` : null),
  () => runJsonArray<Task>(pid, tag, LIST_CMD),
)

// ── Row actions ───────────────────────────────────────────────────────────────

const actingRow    = ref<Task | null>(null)
const actingAction = ref('')

async function rowAction(row: Task, action: 'enable' | 'disable' | 'delete') {
  const confirms: Record<string, string> = {
    enable:  `Enable scheduled task "${row.Name}"?`,
    disable: `Disable scheduled task "${row.Name}"?`,
    delete:  `Permanently delete scheduled task "${row.Name}"? This cannot be undone.`,
  }
  const commands: Record<string, string> = {
    enable:  `Enable-ScheduledTask  -TaskName "${psDQ(row.Name)}" -TaskPath "${psDQ(row.Path)}"`,
    disable: `Disable-ScheduledTask -TaskName "${psDQ(row.Name)}" -TaskPath "${psDQ(row.Path)}"`,
    delete:  `Unregister-ScheduledTask -TaskName "${psDQ(row.Name)}" -TaskPath "${psDQ(row.Path)}" -Confirm:$false`,
  }
  if (!window.confirm(confirms[action])) return
  actingRow.value    = row
  actingAction.value = action
  try {
    const { status, output } = await runJob(pid, tag, commands[action])
    if (status === 'success') await refresh()
    else window.alert(output || `action failed: ${status}`)
  } catch (e: any) {
    window.alert(e.message)
  } finally {
    actingRow.value    = null
    actingAction.value = ''
  }
}

// ── Create form ───────────────────────────────────────────────────────────────

const showCreate = ref(false)

// Task identity
const taskName = ref('')
const taskPath = ref('\\')
const taskDesc = ref('')

// Action
const execute  = ref('')
const taskArgs = ref('')
const workDir  = ref('')

// Trigger
type TriggerType = 'daily' | 'weekly' | 'once' | 'startup' | 'logon'
const triggerType = ref<TriggerType>('daily')

// Default start time: next hour in local time, as "YYYY-MM-DDTHH:mm"
const _d = new Date()
_d.setHours(_d.getHours() + 1, 0, 0, 0)
const startAt    = ref(new Date(_d.getTime() - _d.getTimezoneOffset() * 60000).toISOString().slice(0, 16))
const dailyEvery = ref(1)
const ALL_DAYS   = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const weekDays   = ref<string[]>(['Monday'])

// Principal
type RunAsType = 'SYSTEM' | 'NETWORK SERVICE' | 'custom'
const runAsType    = ref<RunAsType>('SYSTEM')
const runAsCustom  = ref('')
const runHighest   = ref(true)

const creating     = ref(false)
const createStatus = ref('')

const needsTime = computed(() => triggerType.value !== 'startup' && triggerType.value !== 'logon')

const canCreate = computed(() =>
  !!taskName.value.trim() &&
  !!execute.value.trim() &&
  (!needsTime.value || !!startAt.value) &&
  (runAsType.value !== 'custom' || !!runAsCustom.value.trim()),
)

function toggleDay(day: string) {
  const idx = weekDays.value.indexOf(day)
  if (idx >= 0) {
    if (weekDays.value.length > 1) weekDays.value.splice(idx, 1)
  } else {
    weekDays.value.push(day)
  }
}

function buildCreateScript(): string {
  const q = (s: string) => `"${psDQ(s)}"`

  const actionParts = [`-Execute ${q(execute.value.trim())}`]
  if (taskArgs.value.trim()) actionParts.push(`-Argument ${q(taskArgs.value.trim())}`)
  if (workDir.value.trim())  actionParts.push(`-WorkingDirectory ${q(workDir.value.trim())}`)

  const at = q(startAt.value.replace('T', ' '))
  let triggerLine: string
  if      (triggerType.value === 'daily')   triggerLine = `$trigger = New-ScheduledTaskTrigger -Daily -At ${at} -DaysInterval ${dailyEvery.value}`
  else if (triggerType.value === 'weekly')  triggerLine = `$trigger = New-ScheduledTaskTrigger -Weekly -At ${at} -DaysOfWeek ${(weekDays.value.length ? weekDays.value : ['Monday']).join(',')}`
  else if (triggerType.value === 'once')    triggerLine = `$trigger = New-ScheduledTaskTrigger -Once -At ${at}`
  else if (triggerType.value === 'startup') triggerLine = `$trigger = New-ScheduledTaskTrigger -AtStartup`
  else                                      triggerLine = `$trigger = New-ScheduledTaskTrigger -AtLogOn`

  const rl = runHighest.value ? 'Highest' : 'Limited'
  let principalLine: string
  if      (runAsType.value === 'SYSTEM')          principalLine = `$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel ${rl}`
  else if (runAsType.value === 'NETWORK SERVICE') principalLine = `$principal = New-ScheduledTaskPrincipal -UserId "NETWORK SERVICE" -LogonType ServiceAccount -RunLevel ${rl}`
  else                                            principalLine = `$principal = New-ScheduledTaskPrincipal -UserId ${q(runAsCustom.value.trim())} -RunLevel ${rl}`

  const path    = taskPath.value.trim() || '\\'
  const descArg = taskDesc.value.trim() ? ` -Description ${q(taskDesc.value.trim())}` : ''

  return [
    `$action = New-ScheduledTaskAction ${actionParts.join(' ')}`,
    triggerLine,
    principalLine,
    `$settings = New-ScheduledTaskSettingsSet`,
    `Register-ScheduledTask -TaskName ${q(taskName.value.trim())} -TaskPath ${q(path)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings${descArg} -Force`,
    `Write-Output "Done"`,
  ].join('\n')
}

function closeCreate() {
  showCreate.value   = false
  taskName.value     = ''
  taskPath.value     = '\\'
  taskDesc.value     = ''
  execute.value      = ''
  taskArgs.value     = ''
  workDir.value      = ''
  triggerType.value  = 'daily'
  weekDays.value     = ['Monday']
  dailyEvery.value   = 1
  runAsType.value    = 'SYSTEM'
  runAsCustom.value  = ''
  runHighest.value   = true
  createStatus.value = ''
}

async function create() {
  if (!canCreate.value) return
  creating.value     = true
  createStatus.value = ''
  try {
    const { status, output } = await runJob(pid, tag, buildCreateScript())
    if (status === 'success') {
      closeCreate()
      await refresh()
    } else {
      createStatus.value = output || `failed: ${status}`
    }
  } catch (e: any) {
    createStatus.value = e.message
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="flex flex-col h-full">

    <!-- ── Create panel ──────────────────────────────────────────────────── -->
    <div
      v-if="showCreate"
      class="shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 overflow-y-auto"
      style="max-height: 22rem"
    >
      <div class="px-4 py-3 space-y-4">

        <!-- header -->
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">New scheduled task</span>
          <button
            class="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            @click="closeCreate"
          >✕</button>
        </div>

        <!-- identity -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs text-zinc-500 mb-1">Task name <span class="text-red-400">*</span></label>
            <input
              v-model="taskName"
              placeholder="MyTask"
              class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs outline-none focus:border-green-600"
            />
          </div>
          <div>
            <label class="block text-xs text-zinc-500 mb-1">Folder path</label>
            <input
              v-model="taskPath"
              placeholder="\"
              class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs font-mono outline-none focus:border-green-600"
            />
          </div>
          <div class="col-span-2">
            <label class="block text-xs text-zinc-500 mb-1">Description</label>
            <input
              v-model="taskDesc"
              placeholder="Optional"
              class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs outline-none focus:border-green-600"
            />
          </div>
        </div>

        <!-- action -->
        <div>
          <p class="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Action</p>
          <div class="grid grid-cols-2 gap-3">
            <div class="col-span-2">
              <label class="block text-xs text-zinc-500 mb-1">Execute <span class="text-red-400">*</span></label>
              <input
                v-model="execute"
                placeholder="C:\Windows\System32\cmd.exe"
                class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs font-mono outline-none focus:border-green-600"
              />
            </div>
            <div>
              <label class="block text-xs text-zinc-500 mb-1">Arguments</label>
              <input
                v-model="taskArgs"
                placeholder="/c whoami"
                class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs font-mono outline-none focus:border-green-600"
              />
            </div>
            <div>
              <label class="block text-xs text-zinc-500 mb-1">Start in</label>
              <input
                v-model="workDir"
                placeholder="C:\working\dir"
                class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs font-mono outline-none focus:border-green-600"
              />
            </div>
          </div>
        </div>

        <!-- trigger -->
        <div>
          <p class="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Trigger</p>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-zinc-500 mb-1">Type</label>
              <select
                v-model="triggerType"
                class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs outline-none focus:border-green-600"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="once">Once</option>
                <option value="startup">At startup</option>
                <option value="logon">At logon</option>
              </select>
            </div>
            <div v-if="needsTime">
              <label class="block text-xs text-zinc-500 mb-1">{{ triggerType === 'once' ? 'At' : 'Start time' }}</label>
              <input
                v-model="startAt"
                type="datetime-local"
                class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs outline-none focus:border-green-600"
              />
            </div>
            <div v-if="triggerType === 'daily'">
              <label class="block text-xs text-zinc-500 mb-1">Repeat every (days)</label>
              <input
                v-model.number="dailyEvery"
                type="number"
                min="1"
                max="365"
                class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs outline-none focus:border-green-600"
              />
            </div>
            <div v-if="triggerType === 'weekly'" class="col-span-2">
              <label class="block text-xs text-zinc-500 mb-1">Days of week</label>
              <div class="flex gap-1 flex-wrap">
                <button
                  v-for="day in ALL_DAYS"
                  :key="day"
                  type="button"
                  class="text-xs px-2 py-0.5 rounded border transition-colors"
                  :class="
                    weekDays.includes(day)
                      ? 'bg-green-600 text-white border-green-600'
                      : 'border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  "
                  @click="toggleDay(day)"
                >
                  {{ day.slice(0, 3) }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- principal -->
        <div>
          <p class="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Run as</p>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-zinc-500 mb-1">User</label>
              <select
                v-model="runAsType"
                class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs outline-none focus:border-green-600"
              >
                <option value="SYSTEM">SYSTEM</option>
                <option value="NETWORK SERVICE">NETWORK SERVICE</option>
                <option value="custom">Custom…</option>
              </select>
            </div>
            <div v-if="runAsType === 'custom'">
              <label class="block text-xs text-zinc-500 mb-1">Username <span class="text-red-400">*</span></label>
              <input
                v-model="runAsCustom"
                placeholder="DOMAIN\user"
                class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs font-mono outline-none focus:border-green-600"
              />
            </div>
            <div class="col-span-2">
              <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input v-model="runHighest" type="checkbox" />
                Run with highest privileges
              </label>
            </div>
          </div>
        </div>

        <!-- submit -->
        <div class="flex items-center gap-4 pb-1">
          <button
            class="text-xs bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded px-3 py-1.5"
            :disabled="creating || !canCreate"
            @click="create"
          >
            {{ creating ? 'Creating…' : 'Create task' }}
          </button>
          <span v-if="createStatus" class="text-xs text-red-500 truncate max-w-xs">{{ createStatus }}</span>
        </div>

      </div>
    </div>

    <!-- ── Toolbar ───────────────────────────────────────────────────────── -->
    <div
      v-if="!showCreate"
      class="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800"
    >
      <button
        class="text-xs bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded px-2.5 py-1"
        @click="showCreate = true"
      >
        + New task
      </button>
    </div>

    <!-- ── Task list ─────────────────────────────────────────────────────── -->
    <div class="flex-1 min-h-0">
      <DataTable
        :columns="columns"
        :rows="tasks || []"
        :loading="loading"
        :error="error"
        @refresh="refresh"
      >
        <template #actions="{ row }">
          <div class="flex justify-end gap-1.5">
            <button
              v-if="row.State === 'Disabled'"
              class="text-xs px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
              :disabled="actingRow !== null"
              @click="rowAction(row, 'enable')"
            >
              {{ actingRow === row && actingAction === 'enable' ? '…' : 'enable' }}
            </button>
            <button
              v-else
              class="text-xs px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
              :disabled="actingRow !== null"
              @click="rowAction(row, 'disable')"
            >
              {{ actingRow === row && actingAction === 'disable' ? '…' : 'disable' }}
            </button>
            <button
              class="text-xs px-2 py-0.5 rounded border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-40"
              :disabled="actingRow !== null"
              @click="rowAction(row, 'delete')"
            >
              {{ actingRow === row && actingAction === 'delete' ? '…' : 'delete' }}
            </button>
          </div>
        </template>
      </DataTable>
    </div>

  </div>
</template>
