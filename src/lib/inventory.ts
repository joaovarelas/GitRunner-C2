import { store } from '../store'
import { runJson } from './jobs'
import { useCachedJson } from './useCachedJson'
// The collector lives in inventory.ps1 (proper PowerShell file for editing /
// testing) and is bundled in as a string at build time via Vite's ?raw import.
import INVENTORY_CMD from './inventory.ps1?raw'

// Everything a tab needs, collected by ONE pipeline run and cached per
// endpoint. Tabs read sections out of this blob -> no per-table waiting.
// Volatile data (processes, event logs) is NOT here -- those stay live.
export interface Inventory {
  summary: Record<string, any>
  [section: string]: any
}

// Runs the collector once per endpoint (cached); every inventory-backed tab
// shares this. refresh() re-runs it.
export function useInventory() {
  const { data, loading, error, refresh } = useCachedJson<Inventory>(
    () => (store.runner ? `inventory:${store.runner.id}` : null),
    async () => {
      const tag = store.runner!.tag_list?.[0]
      if (!tag) throw new Error('Runner has no tag.')
      return runJson<Inventory>(store.project!.id, tag, INVENTORY_CMD)
    },
  )
  return { inventory: data, loading, error, refresh }
}
