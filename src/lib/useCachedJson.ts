import { ref, watch, reactive, type Ref } from 'vue'

// Module-level cache: data survives component unmount/remount (switching
// endpoint tabs) and even leaving/re-entering an endpoint, since it's keyed by
// a caller-provided string (include the endpoint id). Only a full page reload
// or an explicit refresh re-runs the job.
const cache = reactive<Record<string, unknown>>({})

// `key()` is a reactive getter — when it changes (e.g. a different endpoint or
// sub-view), the cached value is shown instantly, or fetched if not cached yet.
export function useCachedJson<T>(key: () => string | null, fetcher: () => Promise<T>) {
  const data = ref<T | null>(null) as Ref<T | null>
  const loading = ref(false)
  const error = ref('')

  async function run(force: boolean) {
    const k = key()
    if (!k) return
    if (!force && k in cache) {
      data.value = cache[k] as T
      error.value = ''
      return
    }
    if (!force) data.value = null // switching to an uncached view: show loading
    loading.value = true
    error.value = ''
    try {
      const v = await fetcher()
      cache[k] = v
      data.value = v
    } catch (e: any) {
      error.value = e.message
      data.value = null
    } finally {
      loading.value = false
    }
  }

  watch(key, () => run(false), { immediate: true })
  return { data, loading, error, refresh: () => run(true) }
}
