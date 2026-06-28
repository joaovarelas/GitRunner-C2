<script setup lang="ts">
import { ref, computed } from 'vue'
import { store } from '../../store'
import { runJob, runJsonArray } from '../../lib/jobs'
import { useCachedJson } from '../../lib/useCachedJson'
import { useInventory } from '../../lib/inventory'
import { detectAv, PIPES_CMD } from '../../lib/av'
import type { Tab } from '../../lib/tabs'
import DataTable from '../DataTable.vue'
import Drivers from './Drivers.vue'
import TaskScheduler from './TaskScheduler.vue'

const props = defineProps<{ tab: Tab }>()

const active = ref(props.tab.subviews[0].id)
const sub = computed(() => props.tab.subviews.find((s) => s.id === active.value)!)

// Shared inventory blob (cached once per endpoint).
const inv = useInventory()

// Live sub-views (processes, event logs, pipes) fetch their own cached job.
const live = useCachedJson<any[]>(
  () =>
    store.runner && sub.value.source.kind === 'live'
      ? `live:${store.runner.id}:${sub.value.id}`
      : null,
  async () => {
    const tag = store.runner!.tag_list?.[0]
    if (!tag) throw new Error('Runner has no tag.')
    return runJsonArray(store.project!.id, tag, (sub.value.source as { cmd: string }).cmd)
  },
)

// AV/EDR detection: pipes fetched on-demand and cached under the same key as
// the Named Pipes subview — so opening either one populates the other for free.
const pipes = useCachedJson<{ Name: string }[]>(
  () =>
    store.runner && sub.value.source.kind === 'av'
      ? `live:${store.runner.id}:pipes`
      : null,
  async () => {
    const tag = store.runner!.tag_list?.[0]
    if (!tag) throw new Error('Runner has no tag.')
    return runJsonArray(store.project!.id, tag, PIPES_CMD)
  },
)

const isInventory     = computed(() => sub.value.source.kind === 'inventory')
const isAv            = computed(() => sub.value.source.kind === 'av')
const isDrivers       = computed(() => sub.value.source.kind === 'drivers')
const isTaskScheduler = computed(() => sub.value.source.kind === 'taskscheduler')

function sectionData() {
  const src = sub.value.source
  return src.kind === 'inventory' ? inv.inventory.value?.[src.key] : null
}

const rows = computed<Record<string, any>[]>(() => {
  if (sub.value.layout === 'fields') return []
  if (isAv.value) {
    const serviceNames = (inv.inventory.value?.services || []).map((s: any) => s.Name as string)
    const pipeNames = (pipes.data.value || []).map((p) => p.Name)
    return detectAv(serviceNames, pipeNames)
  }
  if (isInventory.value) {
    const d = sectionData()
    return Array.isArray(d) ? d : d == null ? [] : [d]
  }
  return live.data.value || []
})

const fields = computed(() => {
  if (sub.value.layout !== 'fields') return []
  const obj = sectionData() || {}
  return sub.value.columns.map((c) => [c.label, obj[c.key]] as [string, any])
})

const loading = computed(() => {
  if (isAv.value) return inv.loading.value || pipes.loading.value
  return isInventory.value ? inv.loading.value : live.loading.value
})
const error = computed(() => {
  if (isAv.value) return inv.error.value || pipes.error.value
  return isInventory.value ? inv.error.value : live.error.value
})
function refresh() {
  if (isAv.value) { inv.refresh(); pipes.refresh(); return }
  isInventory.value ? inv.refresh() : live.refresh()
}

const actingRow = ref<Record<string, any> | null>(null)
async function doAction(row: Record<string, any>) {
  const action = sub.value.action
  if (!action || !store.project || !store.runner) return
  const tag = store.runner.tag_list?.[0]
  if (!tag) return
  if (!window.confirm(action.confirm(row))) return
  actingRow.value = row
  try {
    const { status, output } = await runJob(store.project.id, tag, action.command(row))
    if (status === 'success') await refresh()
    else window.alert(output || `action failed: ${status}`)
  } catch (e: any) {
    window.alert(e.message)
  } finally {
    actingRow.value = null
  }
}
</script>

<template>
  <div class="flex h-full">
    <!-- sub-view sidebar -->
    <nav class="w-44 shrink-0 border-r border-zinc-200 dark:border-zinc-800 p-2 overflow-y-auto">
      <button
        v-for="s in tab.subviews"
        :key="s.id"
        class="w-full text-left px-3 py-1.5 rounded text-sm mb-0.5"
        :class="
          active === s.id
            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
            : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
        "
        @click="active = s.id"
      >
        {{ s.label }}
      </button>
    </nav>

    <!-- content -->
    <div class="flex-1 min-w-0">
      <!-- self-contained components -->
      <Drivers       v-if="isDrivers" />
      <TaskScheduler v-else-if="isTaskScheduler" />

      <!-- fields layout (single object) -->
      <div v-else-if="sub.layout === 'fields'" class="p-6 overflow-y-auto h-full">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-medium text-zinc-500">{{ sub.label }}</h3>
          <button
            class="text-xs px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            :disabled="loading"
            @click="refresh"
          >
            {{ loading ? 'refreshing…' : 'refresh' }}
          </button>
        </div>
        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
        <dl
          class="max-w-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg divide-y divide-zinc-100 dark:divide-zinc-800/60"
        >
          <div v-for="[label, value] in fields" :key="label" class="flex gap-4 px-4 py-2 text-sm">
            <dt class="w-40 shrink-0 text-zinc-500">{{ label }}</dt>
            <dd class="break-words">{{ value === null || value === undefined || value === '' ? '—' : value }}</dd>
          </div>
        </dl>
      </div>

      <!-- table layout -->
      <DataTable v-else :columns="sub.columns" :rows="rows" :loading="loading" :error="error" :detail-key="sub.detailKey" @refresh="refresh">
        <template v-if="sub.action" #actions="{ row }">
          <button
            class="text-xs px-2 py-0.5 rounded border disabled:opacity-40"
            :class="
              sub.action.danger
                ? 'border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950'
                : 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            "
            :disabled="actingRow !== null"
            @click="doAction(row)"
          >
            {{ actingRow === row ? '…' : sub.action.label }}
          </button>
        </template>
      </DataTable>
    </div>
  </div>
</template>
