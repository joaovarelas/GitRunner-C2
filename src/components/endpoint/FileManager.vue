<script setup lang="ts">
import { ref, watch } from 'vue'
import { store } from '../../store'
import { runJsonArray, downloadFile, uploadAndRun } from '../../lib/jobs'
import { useCachedJson } from '../../lib/useCachedJson'
import { fmtBytes } from '../../lib/format'

interface Entry {
  Name: string
  type: 'd' | 'f'
  size: number | string
  modified: string
}

// path '' = drive list; otherwise a Windows directory path.
const path = ref('')
const pathDraft = ref('')
const downloading = ref('')
const dlError = ref('')
const uploading = ref(false)
const uploadStatus = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

watch(path, (p) => (pathDraft.value = p), { immediate: true })

function listCmd(p: string): string {
  if (!p) {
    // top level: filesystem drives, presented as folders (Name = root path)
    return "Get-PSDrive -PSProvider FileSystem | Select-Object @{n='Name';e={$_.Root}},@{n='type';e={'d'}},@{n='size';e={''}},@{n='modified';e={''}} | ConvertTo-Json -Compress"
  }
  const esc = p.replace(/'/g, "''")
  return (
    `$p='${esc}'; Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue | ` +
    "Select-Object Name,@{n='type';e={if($_.PSIsContainer){'d'}else{'f'}}}," +
    "@{n='size';e={$_.Length}},@{n='modified';e={$_.LastWriteTime.ToString('yyyy-MM-dd HH:mm')}} | " +
    'Sort-Object type,Name | ConvertTo-Json -Compress'
  )
}

const {
  data: entries,
  loading,
  error,
  refresh,
} = useCachedJson<Entry[]>(
  () => (store.runner ? `files:${store.runner.id}:${path.value}` : null),
  async () => {
    const tag = store.runner!.tag_list?.[0]
    if (!tag) throw new Error('Runner has no tag.')
    return runJsonArray<Entry>(store.project!.id, tag, listCmd(path.value))
  },
)

function joinPath(base: string, name: string): string {
  return base.endsWith('\\') ? base + name : base + '\\' + name
}

function goInto(e: Entry) {
  if (e.type !== 'd') return
  // at the drive list, Name is already a full root (e.g. "C:\")
  path.value = path.value ? joinPath(path.value, e.Name) : e.Name
}

function up() {
  const p = path.value
  if (!p) return // already at drive list
  if (/^[A-Za-z]:\\?$/.test(p)) {
    path.value = '' // drive root -> drive list
    return
  }
  const trimmed = p.replace(/\\+$/, '')
  const idx = trimmed.lastIndexOf('\\')
  path.value = idx <= 2 ? trimmed.slice(0, idx + 1) : trimmed.slice(0, idx)
}

function goToDraft() {
  path.value = pathDraft.value.trim()
}

async function upload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || !path.value || !store.project || !store.runner) return
  const tag = store.runner.tag_list?.[0]
  if (!tag) return
  // Escape for use inside a PowerShell double-quoted string.
  const dest = joinPath(path.value, file.name).replace(/[`"$]/g, '`$&')
  uploading.value = true
  uploadStatus.value = ''
  try {
    const { status, output } = await uploadAndRun(
      store.project.id,
      tag,
      file,
      (fileUrl) =>
        `Invoke-WebRequest -Uri "${fileUrl}" ` +
        `-Headers @{'JOB-TOKEN' = $env:CI_JOB_TOKEN} ` +
        `-OutFile "${dest}"\n` +
        'Write-Output "Done"',
      { onStatus: (msg) => { uploadStatus.value = msg } },
    )
    if (status === 'success') {
      uploadStatus.value = ''
      refresh()
    } else {
      uploadStatus.value = output || `upload failed: ${status}`
    }
  } catch (err: any) {
    uploadStatus.value = err.message
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function download(e: Entry) {
  if (!store.project || !store.runner) return
  const tag = store.runner.tag_list?.[0]
  if (!tag) return
  const full = joinPath(path.value, e.Name)
  downloading.value = e.Name
  dlError.value = ''
  try {
    const { blob, filename } = await downloadFile(store.project.id, tag, full)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  } catch (err: any) {
    dlError.value = `${e.Name}: ${err.message}`
  } finally {
    downloading.value = ''
  }
}

</script>

<template>
  <div class="flex flex-col h-full">
    <!-- toolbar -->
    <div class="flex items-center gap-2 px-4 py-2 shrink-0 border-b border-zinc-200 dark:border-zinc-800">
      <button
        class="text-xs px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
        :disabled="!path"
        title="Drives"
        @click="path = ''"
      >
        drives
      </button>
      <button
        class="text-sm px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
        :disabled="!path"
        title="Up"
        @click="up"
      >
        ↑
      </button>
      <form class="flex-1 min-w-0" @submit.prevent="goToDraft">
        <input
          v-model="pathDraft"
          placeholder="drives"
          class="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-sm font-mono outline-none focus:border-green-600"
        />
      </form>
      <button
        class="text-xs px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        :disabled="uploading || !path"
        title="Upload a file to the current directory"
        @click="fileInput?.click()"
      >
        {{ uploading ? uploadStatus || 'uploading…' : '↑ upload' }}
      </button>
      <input ref="fileInput" type="file" class="hidden" @change="upload" />
      <button
        class="text-xs px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        :disabled="loading"
        @click="refresh"
      >
        {{ loading ? 'loading…' : 'refresh' }}
      </button>
    </div>

    <p v-if="error" class="px-4 py-2 text-sm text-red-500 break-words">{{ error }}</p>
    <p v-if="dlError" class="px-4 py-2 text-sm text-red-500 break-words">{{ dlError }}</p>
    <p v-if="uploadStatus && !uploading" class="px-4 py-2 text-sm text-red-500 break-words">{{ uploadStatus }}</p>

    <div class="flex-1 min-h-0 overflow-auto">
      <table class="w-full text-sm">
        <tbody>
          <tr
            v-for="(e, i) in entries || []"
            :key="i"
            class="border-b border-zinc-100 dark:border-zinc-800/60 hover:bg-zinc-100/60 dark:hover:bg-zinc-900"
          >
            <td class="py-1.5 pl-4 pr-2 w-6">
              <!-- folder -->
              <svg
                v-if="e.type === 'd'"
                viewBox="0 0 24 24"
                class="w-4 h-4 text-amber-500"
                fill="currentColor"
              >
                <path d="M2 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
              </svg>
              <!-- file -->
              <svg v-else viewBox="0 0 24 24" class="w-4 h-4 text-zinc-400" fill="currentColor">
                <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6z" />
              </svg>
            </td>
            <td class="py-1.5 pr-4">
              <button
                v-if="e.type === 'd'"
                class="text-left hover:text-green-600 dark:hover:text-green-400 hover:underline"
                @click="goInto(e)"
              >
                {{ e.Name }}
              </button>
              <span v-else>{{ e.Name }}</span>
            </td>
            <td class="py-1.5 pr-4 text-right text-zinc-500 tabular-nums w-24">
              {{ e.type === 'f' ? fmtBytes(e.size) : '' }}
            </td>
            <td class="py-1.5 pr-4 text-zinc-500 w-40">{{ e.modified }}</td>
            <td class="py-1.5 pr-4 w-24 text-right">
              <button
                v-if="e.type === 'f'"
                class="text-xs px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                :disabled="!!downloading"
                @click="download(e)"
              >
                {{ downloading === e.Name ? '…' : 'download' }}
              </button>
            </td>
          </tr>
          <tr v-if="!loading && !(entries && entries.length)">
            <td colspan="5" class="py-6 text-center text-zinc-500">
              {{ path ? 'empty or inaccessible' : 'no drives' }}
            </td>
          </tr>
          <tr v-if="loading && !(entries && entries.length)">
            <td colspan="5" class="py-6 text-center text-zinc-500">listing (running a job)…</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
