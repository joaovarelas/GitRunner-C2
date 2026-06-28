import { gl } from '../api/gitlab'
import { store } from '../store'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A GitLab job trace is noisy: runner preamble, ANSI codes, section markers,
// optional per-line RFC3339 timestamps, and the shell command-echo. Reduce it
// to just the output of the script step.
function cleanLine(l: string): string {
  return l
    .replace(/^\S+T[0-9:.]+Z\s+\w*[OE][+ ]?/, '') // "2026-...Z 00O+/01E " timestamp+stream prefix
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') // CSI sequences
    .replace(/\x1b\]0;[^\x07]*\x07/g, '') // window-title sequences
    .replace(/section_(start|end):\d+:[\w.-]+/g, '')
    .replace(/\r/g, '')
}

function extractScript(raw: string): string {
  const lines = raw.split('\n').map(cleanLine)
  const start = lines.findIndex((l) => l.includes('Executing "step_script"'))
  if (start < 0) return '' // script step hasn't started yet
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (
      /^(Cleaning up|Uploading artifacts|Saving cache|Running after_script|Job succeeded|ERROR: Job failed)/.test(
        lines[i].trim(),
      )
    ) {
      end = i
      break
    }
  }
  return lines
    .slice(start + 1, end)
    .filter((l) => !/^\$ /.test(l.trim())) // drop shell command-echo
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

export interface RunOptions {
  onChunk?: (delta: string) => void
  onStatus?: (msg: string) => void
}

export interface RunResult {
  status: string
  output: string
  jobId: number
}

// Triggers the managed pipeline with a command targeted at one runner tag,
// then polls until the job finishes. The single place that knows how a
// "command" maps onto GitLab CI.
export async function runJob(
  pid: number,
  tag: string,
  cmd: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  await gl.ensureCiFile(pid)
  const pipe = await gl.triggerPipeline(pid, tag, cmd)

  let job: { id: number; status: string } | null = null
  for (let i = 0; i < 80 && !job; i++) {
    const jobs = await gl.pipelineJobs(pid, pipe.id)
    job = jobs.find((j) => j.name === 'run_command') || jobs[0] || null
    if (!job) await sleep(1500)
  }
  if (!job) throw new Error('No job was created — is a runner online for this tag?')
  opts.onStatus?.(`job #${job.id} dispatched to [${tag}]`)

  let printed = 0
  let status = job.status
  const finished = (s: string) => ['success', 'failed', 'canceled', 'skipped'].includes(s)
  for (let i = 0; i < 200 && !finished(status); i++) {
    await sleep(1500)
    status = (await gl.getJob(pid, job.id)).status
    if (opts.onChunk) {
      const out = extractScript(await gl.getTrace(pid, job.id))
      if (out.length > printed) {
        opts.onChunk(out.slice(printed))
        printed = out.length
      }
    }
  }

  const output = extractScript(await gl.getTrace(pid, job.id))
  if (opts.onChunk && output.length > printed) opts.onChunk(output.slice(printed))
  return { status, output, jobId: job.id }
}

function parseJson(output: string): any {
  // The script step may emit warnings/errors before the JSON. Start from the
  // first line that begins a JSON value, dropping any preceding noise (whose
  // stray braces would otherwise be mistaken for the JSON start).
  const lines = output.split('\n')
  const idx = lines.findIndex((l) => {
    const t = l.trim()
    return t.startsWith('{') || t.startsWith('[')
  })
  const region = idx >= 0 ? lines.slice(idx).join('\n') : output
  // PowerShell wraps long console lines, injecting raw CR/LF into the
  // (compressed) JSON -- sometimes inside string values, which JSON.parse
  // rejects. Compressed JSON has no legitimate raw control chars, so strip
  // them all to rejoin the fragments before parsing.
  const s = region.replace(/[\x00-\x1F]/g, '').trim()
  try {
    return JSON.parse(s)
  } catch {
    const start = Math.min(...[s.indexOf('{'), s.indexOf('[')].filter((i) => i >= 0))
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'))
    if (isFinite(start) && end > start) return JSON.parse(s.slice(start, end + 1))
    throw new Error('Could not parse JSON from output:\n' + output.slice(0, 300))
  }
}

// Run a command whose output is JSON (e.g. `... | ConvertTo-Json`) and return
// the parsed value. Throws with the raw output if the job failed or wasn't JSON.
export async function runJson<T = any>(pid: number, tag: string, cmd: string): Promise<T> {
  const { status, output } = await runJob(pid, tag, cmd)
  if (status !== 'success') throw new Error(output || `job ${status}`)
  return parseJson(output) as T
}

// Same, but always returns an array (ConvertTo-Json unwraps single-element
// results into a bare object).
export async function runJsonArray<T = any>(pid: number, tag: string, cmd: string): Promise<T[]> {
  const v = await runJson<T | T[]>(pid, tag, cmd)
  return Array.isArray(v) ? v : v == null ? [] : [v]
}

// Pulls a file off the endpoint: triggers the download_file job (which copies
// the file into the workspace as an artifact), waits for it, then fetches the
// artifact as a Blob. No git.exe needed on the endpoint.
export async function downloadFile(
  pid: number,
  tag: string,
  fullPath: string,
  onStatus?: (msg: string) => void,
): Promise<{ blob: Blob; filename: string }> {
  await gl.ensureCiFile(pid)
  const pipe = await gl.triggerPipelineVars(pid, [
    { key: 'TARGET_TAG', value: tag },
    // raw: paths can contain $ (e.g. C:\$Recycle.Bin)
    { key: 'DL_PATH', value: fullPath, raw: true },
  ])

  let job: { id: number; status: string } | null = null
  for (let i = 0; i < 80 && !job; i++) {
    const jobs = await gl.pipelineJobs(pid, pipe.id)
    job = jobs.find((j) => j.name === 'download_file') || null
    if (!job) await sleep(1500)
  }
  if (!job) throw new Error('No download job created — is a runner online for this tag?')
  onStatus?.(`job #${job.id}: copying file…`)

  let status = job.status
  const finished = (s: string) => ['success', 'failed', 'canceled', 'skipped'].includes(s)
  for (let i = 0; i < 200 && !finished(status); i++) {
    await sleep(1500)
    status = (await gl.getJob(pid, job.id)).status
  }
  if (status !== 'success') {
    throw new Error(extractScript(await gl.getTrace(pid, job.id)) || `download job ${status}`)
  }

  const filename = fullPath.split(/[\\/]/).pop() || 'download'
  const blob = await gl.getArtifactFile(pid, job.id, 'dl/' + encodeURIComponent(filename))
  return { blob, filename }
}

// Upload a file to the GitLab Generic Package Registry, run a command on the
// endpoint whose script receives the direct download URL (runner authenticates
// with CI_JOB_TOKEN — same-project access), then delete the package.
// buildScript receives the full download URL and returns the PowerShell to run.
export async function uploadAndRun(
  pid: number,
  tag: string,
  file: File,
  buildScript: (fileUrl: string) => string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const version = `tmp-${Date.now()}`
  opts.onStatus?.('Uploading to package registry…')
  await gl.uploadPackage(pid, version, file.name, file)

  const fileUrl =
    `${store.gitlabUrl}/api/v4/projects/${pid}/packages/generic/` +
    `gitrunner-uploads/${version}/${encodeURIComponent(file.name)}`

  try {
    return await runJob(pid, tag, buildScript(fileUrl), opts)
  } finally {
    // Best-effort cleanup — non-fatal if it fails.
    gl.listPackages(pid, 'gitrunner-uploads')
      .then((pkgs) => {
        const mine = pkgs.find((p) => p.version === version)
        if (mine) return gl.deletePackage(pid, mine.id)
      })
      .catch(() => {})
  }
}
