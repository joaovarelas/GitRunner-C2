<script setup lang="ts">
import { store, logout, toggleTheme } from './store'
import Settings from './components/Settings.vue'
import ProjectList from './components/ProjectList.vue'
import RunnerList from './components/RunnerList.vue'
import EndpointView from './components/endpoint/EndpointView.vue'
</script>

<template>
  <!-- Not connected: token form -->
  <div
    v-if="!store.token"
    class="h-full grid place-items-center bg-zinc-100 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
  >
    <Settings />
  </div>

  <!-- Connected: sidebar + main -->
  <div v-else class="h-full flex bg-zinc-100 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
    <aside class="w-72 shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
      <div
        class="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between"
      >
        <span class="font-semibold tracking-tight">GitRunner <span class="text-green-600 dark:text-green-500">C2</span></span>
        <button
          class="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          @click="logout"
        >
          logout
        </button>
      </div>

      <ProjectList class="flex-1 overflow-y-auto" />

      <div
        class="px-4 py-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2"
      >
        <span class="text-[11px] text-zinc-500 truncate">{{ store.gitlabUrl }}</span>
        <button
          class="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 shrink-0"
          :title="store.theme === 'dark' ? 'Switch to light' : 'Switch to dark'"
          @click="toggleTheme"
        >
          {{ store.theme === 'dark' ? 'Light' : 'Dark' }}
        </button>
      </div>
    </aside>

    <main class="flex-1 min-w-0 flex flex-col">
      <template v-if="store.project">
        <EndpointView v-if="store.runner" :key="store.runner.id" />
        <RunnerList v-else />
      </template>
      <div v-else class="flex-1 grid place-items-center text-zinc-400 dark:text-zinc-600">
        Select or create a project to begin
      </div>
    </main>
  </div>
</template>
