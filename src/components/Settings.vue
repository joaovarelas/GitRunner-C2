<script setup lang="ts">
import { ref } from 'vue'
import { store, saveAuth } from '../store'

const url = ref(store.gitlabUrl)
const token = ref(store.token)

function submit() {
  if (token.value.trim()) saveAuth(url.value.trim(), token.value.trim())
}
</script>

<template>
  <form
    class="w-[26rem] max-w-[90vw] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 space-y-4"
    @submit.prevent="submit"
  >
    <div>
      <h1 class="text-lg font-semibold">GitRunner <span class="text-green-600 dark:text-green-500">C2</span></h1>
      <p class="text-xs text-zinc-500 mt-1">
        Connect with a GitLab Personal Access Token (scope:
        <code class="text-zinc-700 dark:text-zinc-300">api</code>).
      </p>
    </div>

    <label class="block text-sm">
      <span class="text-zinc-500">GitLab URL</span>
      <input
        v-model="url"
        class="mt-1 w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-3 py-2 outline-none focus:border-green-600"
        placeholder="https://gitlab.com"
      />
    </label>

    <label class="block text-sm">
      <span class="text-zinc-500">Personal Access Token</span>
      <input
        v-model="token"
        type="password"
        class="mt-1 w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-3 py-2 outline-none focus:border-green-600"
        placeholder="glpat-..."
      />
    </label>

    <button class="w-full bg-green-600 hover:bg-green-500 text-white rounded py-2 text-sm font-medium">
      Connect
    </button>
  </form>
</template>
