<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { store } from '../store'
import { gl, type Project } from '../api/gitlab'

const projects = ref<Project[]>([])
const loading = ref(false)
const error = ref('')
const newName = ref('')
const creating = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    projects.value = await gl.listProjects()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function create() {
  if (!newName.value.trim()) return
  creating.value = true
  error.value = ''
  try {
    const p = await gl.createProject(newName.value.trim())
    newName.value = ''
    await load()
    select(p)
  } catch (e: any) {
    error.value = e.message
  } finally {
    creating.value = false
  }
}

function select(p: Project) {
  store.project = p
  store.runner = null
}

onMounted(load)
</script>

<template>
  <div class="p-3 space-y-3">
    <form class="flex gap-2" @submit.prevent="create">
      <input
        v-model="newName"
        placeholder="new project name"
        class="flex-1 min-w-0 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 text-sm outline-none focus:border-green-600"
      />
      <button
        :disabled="creating"
        class="px-2.5 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded text-sm disabled:opacity-50"
      >
        +
      </button>
    </form>

    <p v-if="error" class="text-xs text-red-500 break-words">{{ error }}</p>
    <div v-if="loading" class="text-xs text-zinc-500">loading…</div>

    <ul class="space-y-1">
      <li v-for="p in projects" :key="p.id">
        <button
          class="w-full text-left px-2.5 py-2 rounded text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          :class="
            store.project?.id === p.id
              ? 'bg-zinc-100 dark:bg-zinc-800 text-green-700 dark:text-green-400'
              : 'text-zinc-700 dark:text-zinc-300'
          "
          @click="select(p)"
        >
          <span class="block truncate">{{ p.name }}</span>
          <span class="block text-[11px] text-zinc-500 truncate">{{ p.path_with_namespace }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
