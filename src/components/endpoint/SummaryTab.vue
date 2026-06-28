<script setup lang="ts">
import { computed, watch } from 'vue'
import { store } from '../../store'
import { useInventory } from '../../lib/inventory'
import { setFacts } from '../../lib/endpointCache'

const { inventory, loading, error, refresh } = useInventory()
const info = computed<Record<string, any> | null>(() => inventory.value?.summary ?? null)

// Cache the IP/OS we learn so the endpoint list can show it.
watch(info, (i) => {
  if (i && store.runner) setFacts(store.runner.id, { ip: i.ip })
})

// CPU + Memory as progress bars; Disk as a donut.
const usageBars = computed(() => {
  const i = info.value
  if (!i) return []
  const memUsed = Math.max(0, +((i.ram_gb ?? 0) - (i.ram_free_gb ?? 0)).toFixed(1))
  const memPct = i.ram_gb ? Math.round((memUsed / i.ram_gb) * 100) : 0
  return [
    {
      label: 'CPU',
      pct: i.cpu_load ?? 0,
      topRight: `${i.cores} cores · ${i.logical} logical`,
      bottom: `${i.cpu_load ?? 0}% load`,
    },
    {
      label: 'Memory',
      pct: memPct,
      topRight: `${memUsed} / ${i.ram_gb} GB`,
      bottom: `${memPct}% used · ${i.ram_free_gb} GB free`,
    },
  ]
})

const disk = computed(() => {
  const i = info.value
  if (!i) return null
  const used = Math.max(0, +((i.disk_total_gb ?? 0) - (i.disk_free_gb ?? 0)).toFixed(1))
  const pct = i.disk_total_gb ? Math.round((used / i.disk_total_gb) * 100) : 0
  return { used, pct, total: i.disk_total_gb, free: i.disk_free_gb }
})

function barColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500'
  if (pct >= 75) return 'bg-amber-500'
  return 'bg-green-600 dark:bg-green-500'
}
function ringColor(pct: number): string {
  if (pct >= 90) return 'text-red-500'
  if (pct >= 75) return 'text-amber-500'
  return 'text-green-600 dark:text-green-500'
}

const quickFacts = computed(() => {
  const i = info.value
  if (!i) return []
  return [
    { k: 'IP Address', v: i.ip || '—' },
    { k: 'Current User', v: i.current_user || '—' },
    { k: 'Logged-on Users', v: i.logged_on || '—' },
    { k: 'Workgroup / Domain', v: i.domain },
    { k: 'Uptime', v: i.uptime },
    { k: 'Last Boot', v: i.last_boot },
  ]
})

const osSummary = computed<[string, any][]>(() => {
  const i = info.value
  if (!i) return []
  return [
    ['Operating System', i.os],
    ['OS Version', i.os_version],
    ['Build Number', i.build],
    ['Architecture', i.arch],
    ['Registered to', i.registered_owner],
    ['Product ID', i.product_id],
    ['Install Date', i.install_date],
  ]
})

const deviceSummary = computed<[string, any][]>(() => {
  const i = info.value
  if (!i) return []
  return [
    ['Manufacturer', i.manufacturer],
    ['Model', i.model],
    ['Serial Number', i.serial],
    ['Processor', i.cpu],
    ['Cores / Logical', `${i.cores} / ${i.logical}`],
    ['Memory', `${i.ram_gb} GB`],
  ]
})
</script>

<template>
  <div class="p-6 overflow-y-auto h-full">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-medium text-zinc-500">System summary</h3>
      <button
        class="text-xs px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        :disabled="loading"
        @click="refresh"
      >
        {{ loading ? 'refreshing…' : 'refresh' }}
      </button>
    </div>

    <div v-if="loading && !info" class="text-sm text-zinc-500">
      collecting inventory (running one job)…
    </div>
    <p v-if="error" class="text-sm text-red-500 break-words whitespace-pre-wrap">{{ error }}</p>

    <div v-if="info" class="space-y-4">
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
        <div
          v-for="f in quickFacts"
          :key="f.k"
          class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3"
        >
          <div class="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{{ f.k }}</div>
          <div class="mt-1 text-sm break-words">{{ f.v }}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <!-- CPU + Memory progress bars -->
        <div
          v-for="u in usageBars"
          :key="u.label"
          class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4"
        >
          <div class="flex items-center justify-between text-sm">
            <span class="font-medium">{{ u.label }}</span>
            <span class="text-zinc-500">{{ u.topRight }}</span>
          </div>
          <div class="mt-2 h-2.5 rounded bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div class="h-full" :class="barColor(u.pct)" :style="{ width: u.pct + '%' }"></div>
          </div>
          <div class="mt-1 text-xs text-zinc-500">{{ u.bottom }}</div>
        </div>

        <!-- Disk donut -->
        <div
          v-if="disk"
          class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex items-center gap-4"
        >
          <svg viewBox="0 0 36 36" class="w-20 h-20 shrink-0 -rotate-90">
            <circle
              cx="18" cy="18" r="15.915" fill="none" stroke="currentColor" stroke-width="3.5"
              class="text-zinc-200 dark:text-zinc-800"
            />
            <circle
              cx="18" cy="18" r="15.915" fill="none" stroke="currentColor" stroke-width="3.5"
              stroke-linecap="round" :class="ringColor(disk.pct)"
              :stroke-dasharray="`${disk.pct} ${100 - disk.pct}`"
            />
          </svg>
          <div class="min-w-0">
            <div class="text-sm font-medium">Disk C:</div>
            <div class="text-2xl font-semibold leading-tight">{{ disk.pct }}%</div>
            <div class="text-xs text-zinc-500">{{ disk.used }} / {{ disk.total }} GB · {{ disk.free }} GB free</div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section
          v-for="sec in [
            { title: 'OS summary', rows: osSummary },
            { title: 'Device summary', rows: deviceSummary },
          ]"
          :key="sec.title"
          class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg"
        >
          <div class="px-4 py-2.5 text-sm font-medium border-b border-zinc-200 dark:border-zinc-800">
            {{ sec.title }}
          </div>
          <dl class="px-4 py-2 divide-y divide-zinc-100 dark:divide-zinc-800/60">
            <div v-for="row in sec.rows" :key="row[0]" class="flex gap-4 py-1.5 text-sm">
              <dt class="w-40 shrink-0 text-zinc-500">{{ row[0] }}</dt>
              <dd class="break-words">{{ row[1] || '—' }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  </div>
</template>
