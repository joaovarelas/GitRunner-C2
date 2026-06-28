<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Column } from '../lib/tabs'

const props = defineProps<{
  columns: Column[]
  rows: Record<string, any>[]
  loading: boolean
  error: string
  detailKey?: string
}>()

defineEmits<{ refresh: [] }>()

const q = ref('')

const filtered = computed(() => {
  if (!q.value) return props.rows
  const needle = q.value.toLowerCase()
  return props.rows.filter((r) => JSON.stringify(r).toLowerCase().includes(needle))
})

function display(c: Column, r: Record<string, any>): string {
  const v = c.format ? c.format(r[c.key], r) : r[c.key]
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

const expandedRow = ref<Record<string, any> | null>(null)
function toggleExpand(r: Record<string, any>) {
  expandedRow.value = expandedRow.value === r ? null : r
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center gap-3 px-4 py-2 shrink-0">
      <input
        v-model="q"
        placeholder="filter…"
        class="w-56 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs outline-none focus:border-green-600"
      />
      <span class="text-xs text-zinc-500">{{ filtered.length }} of {{ rows.length }}</span>
      <button
        class="ml-auto text-xs px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        :disabled="loading"
        @click="$emit('refresh')"
      >
        {{ loading ? 'loading…' : 'refresh' }}
      </button>
    </div>

    <p v-if="error" class="px-4 text-sm text-red-500 break-words whitespace-pre-wrap">{{ error }}</p>

    <div class="flex-1 min-h-0 overflow-auto px-4 pb-4">
      <table class="w-full text-sm border-collapse">
        <thead class="sticky top-0 bg-zinc-100 dark:bg-zinc-950">
          <tr class="text-left text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            <th
              v-for="c in columns"
              :key="c.key"
              class="font-medium py-2 pr-4 border-b border-zinc-200 dark:border-zinc-800 whitespace-nowrap"
              :class="c.align === 'right' ? 'text-right' : ''"
            >
              {{ c.label }}
            </th>
            <th
              v-if="$slots.actions"
              class="font-medium py-2 pr-4 border-b border-zinc-200 dark:border-zinc-800 text-right"
            >
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(r, i) in filtered" :key="i">
            <tr
              class="border-b border-zinc-100 dark:border-zinc-800/60 hover:bg-zinc-100/60 dark:hover:bg-zinc-900"
              :class="detailKey ? 'cursor-pointer select-none' : ''"
              @click="detailKey && toggleExpand(r)"
            >
              <td
                v-for="c in columns"
                :key="c.key"
                class="py-1.5 pr-4 align-top"
                :class="c.align === 'right' ? 'text-right tabular-nums whitespace-nowrap' : ''"
              >
                <div
                  v-if="c.truncate"
                  class="max-w-[22rem] truncate"
                  :class="c.mono ? 'font-mono text-xs' : ''"
                >
                  {{ display(c, r) }}
                </div>
                <span v-else :class="[c.mono ? 'font-mono text-xs' : '', c.align ? '' : 'whitespace-nowrap']">
                  {{ display(c, r) }}
                </span>
              </td>
              <td v-if="$slots.actions" class="py-1.5 pr-4 align-top text-right" @click.stop>
                <slot name="actions" :row="r" />
              </td>
            </tr>
            <tr v-if="detailKey && expandedRow === r" class="border-b border-zinc-200 dark:border-zinc-700">
              <td :colspan="columns.length + ($slots.actions ? 1 : 0)" class="px-4 pb-3 pt-1">
                <pre class="text-xs whitespace-pre-wrap font-mono bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-700 rounded p-3 text-zinc-700 dark:text-zinc-300 max-h-64 overflow-y-auto">{{ r[detailKey] }}</pre>
              </td>
            </tr>
          </template>
          <tr v-if="!loading && !filtered.length">
            <td
              :colspan="columns.length + ($slots.actions ? 1 : 0)"
              class="py-6 text-center text-zinc-500 text-sm"
            >
              {{ rows.length ? 'no matches' : 'no data' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
