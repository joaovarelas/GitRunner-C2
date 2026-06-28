import { fmtBytes } from './format'
import { PIPES_CMD } from './av'

export interface Column {
  key: string
  label: string
  mono?: boolean
  truncate?: boolean
  align?: 'right'
  format?: (value: any, row: Record<string, any>) => string
}

export interface RowAction {
  label: string
  danger?: boolean
  confirm: (row: Record<string, any>) => string
  command: (row: Record<string, any>) => string
}

// Where a sub-view's rows come from: a section of the cached inventory blob
// (instant), a live job (volatile data), the client-side AV detector, or the
// dedicated TaskScheduler component.
export type Source =
  | { kind: 'inventory'; key: string }
  | { kind: 'live'; cmd: string }
  | { kind: 'av' }
  | { kind: 'taskscheduler' }
  | { kind: 'drivers' }

export interface SubView {
  id: string
  label: string
  source: Source
  columns: Column[]
  layout?: 'table' | 'fields' // 'fields' = single object as label/value rows
  action?: RowAction
  detailKey?: string           // row field shown in the expandable detail panel
}

export interface Tab {
  id: string
  label: string
  subviews: SubView[]
}

// ---- shared bits -------------------------------------------------------------

const PROCESS_CMD =
  'Get-Process -IncludeUserName -ErrorAction SilentlyContinue | Select-Object ' +
  "@{n='Name';e={$_.ProcessName}},Id,@{n='User';e={$_.UserName}}," +
  "@{n='Mem';e={[int64]$_.WorkingSet64}}," +
  "@{n='Started';e={try{$_.StartTime.ToString('yyyy-MM-dd HH:mm')}catch{''}}}," +
  'Path | Sort-Object Name | ConvertTo-Json -Compress'

// Top-100 most recent entries from a standard Windows event log.
// Full message is stored; the table truncates it visually and expands on row click.
const eventLogCmd = (logName: string) =>
  `Get-WinEvent -LogName '${logName}' -MaxEvents 100 -ErrorAction SilentlyContinue | ` +
  `Select-Object ` +
  `@{n='Level';e={$_.LevelDisplayName}},` +
  `@{n='Time';e={$_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')}},` +
  `@{n='Source';e={$_.ProviderName}},` +
  `@{n='Id';e={$_.Id}},` +
  `@{n='Message';e={$_.Message}},` +
  `@{n='Computer';e={$_.MachineName}} | ` +
  `ConvertTo-Json -Compress`

const EVT_COLS: Column[] = [
  { key: 'Level',    label: 'Level' },
  { key: 'Time',     label: 'Time' },
  { key: 'Source',   label: 'Source',   truncate: true },
  { key: 'Id',       label: 'Event ID', align: 'right' },
  { key: 'Message',  label: 'Message',  truncate: true },
  { key: 'Computer', label: 'Computer' },
]

const yesNo = (v: any) => (v === 1 || v === true || v === '1' || v === 'True' ? 'Enabled' : 'Disabled')
// "FullyDecrypted" -> "Fully Decrypted", "OperatingSystem" -> "Operating System"
const spaced = (v: any) => String(v ?? '').replace(/([a-z])([A-Z])/g, '$1 $2')

const FW_CMD = 'Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json -Compress'

const BL_CMD =
  "$v = try { Get-BitLockerVolume } catch { $null }; if(-not $v){ '[]' } else { @($v | Select-Object @{n='Volume';e={$_.MountPoint}},@{n='Protection';e={[string]$_.ProtectionStatus}},@{n='Status';e={[string]$_.VolumeStatus}},@{n='Encryption';e={[string]$_.EncryptionMethod}},@{n='Lock';e={[string]$_.LockStatus}},@{n='Type';e={[string]$_.VolumeType}},@{n='Percent';e={$_.EncryptionPercentage}}) | ConvertTo-Json -Compress }"

// ---- tabs --------------------------------------------------------------------

export const tabs: Tab[] = [
  {
    id: 'system',
    label: 'System',
    subviews: [
      {
        id: 'services',
        label: 'Services',
        source: { kind: 'inventory', key: 'services' },
        columns: [
          { key: 'Name', label: 'Name' },
          { key: 'DisplayName', label: 'Display name', truncate: true },
          { key: 'State', label: 'State' },
          { key: 'StartMode', label: 'Start mode' },
          { key: 'StartName', label: 'Runs as', truncate: true },
        ],
      },
      {
        id: 'users',
        label: 'Users',
        source: { kind: 'inventory', key: 'users' },
        columns: [
          { key: 'Name', label: 'Name' },
          { key: 'FullName', label: 'Full name' },
          { key: 'Disabled', label: 'Disabled' },
          { key: 'Description', label: 'Description', truncate: true },
          { key: 'SID', label: 'SID', mono: true, truncate: true },
        ],
      },
      {
        id: 'groups',
        label: 'Groups',
        source: { kind: 'inventory', key: 'groups' },
        columns: [
          { key: 'Name', label: 'Name' },
          { key: 'Description', label: 'Description', truncate: true },
          { key: 'SID', label: 'SID', mono: true, truncate: true },
        ],
      },
      {
        id: 'pipes',
        label: 'Named Pipes',
        source: { kind: 'live', cmd: PIPES_CMD },
        columns: [{ key: 'Name', label: 'Pipe name', mono: true }],
      },
      {
        id: 'drivers',
        label: 'Drivers',
        source: { kind: 'drivers' },
        columns: [],
      },
      {
        id: 'taskscheduler',
        label: 'Task Scheduler',
        source: { kind: 'taskscheduler' },
        columns: [],
      },
      {
        id: 'tasks',
        label: 'Task Manager',
        source: { kind: 'live', cmd: PROCESS_CMD },
        columns: [
          { key: 'Name', label: 'Name' },
          { key: 'Id', label: 'PID', align: 'right' },
          { key: 'User', label: 'User' },
          { key: 'Mem', label: 'Memory', align: 'right', format: (v) => fmtBytes(v) },
          { key: 'Started', label: 'Started' },
          { key: 'Path', label: 'Executable path', mono: true, truncate: true },
        ],
        action: {
          label: 'kill',
          danger: true,
          confirm: (r) => `Kill ${r.Name} (PID ${r.Id})?`,
          command: (r) => `Stop-Process -Id ${r.Id} -Force`,
        },
      },
    ],
  },
  {
    id: 'hardware',
    label: 'Hardware',
    subviews: [
      {
        id: 'bios',
        label: 'BIOS',
        source: { kind: 'inventory', key: 'bios' },
        layout: 'fields',
        columns: [
          { key: 'Manufacturer', label: 'Manufacturer' },
          { key: 'Version', label: 'Version' },
          { key: 'Serial', label: 'Serial number' },
          { key: 'Released', label: 'Release date' },
        ],
      },
      {
        id: 'motherboard',
        label: 'Motherboard',
        source: { kind: 'inventory', key: 'motherboard' },
        layout: 'fields',
        columns: [
          { key: 'Manufacturer', label: 'Manufacturer' },
          { key: 'Product', label: 'Product' },
          { key: 'Version', label: 'Version' },
          { key: 'SerialNumber', label: 'Serial number' },
        ],
      },
      {
        id: 'processors',
        label: 'Processors',
        source: { kind: 'inventory', key: 'processors' },
        columns: [
          { key: 'Name', label: 'Name' },
          { key: 'Cores', label: 'Cores', align: 'right' },
          { key: 'Logical', label: 'Logical', align: 'right' },
          { key: 'MaxClockMHz', label: 'Max clock (MHz)', align: 'right' },
        ],
      },
      {
        id: 'memory',
        label: 'Physical memory',
        source: { kind: 'inventory', key: 'memory' },
        columns: [
          { key: 'Slot', label: 'Slot' },
          { key: 'Manufacturer', label: 'Manufacturer' },
          { key: 'CapacityGB', label: 'Capacity (GB)', align: 'right' },
          { key: 'SpeedMHz', label: 'Speed (MHz)', align: 'right' },
        ],
      },
      {
        id: 'disks',
        label: 'Disks',
        source: { kind: 'inventory', key: 'disks' },
        columns: [
          { key: 'Model', label: 'Model' },
          { key: 'SizeGB', label: 'Size (GB)', align: 'right' },
          { key: 'InterfaceType', label: 'Interface' },
          { key: 'Serial', label: 'Serial', mono: true, truncate: true },
        ],
      },
      {
        id: 'network',
        label: 'Network adapters',
        source: { kind: 'inventory', key: 'network' },
        columns: [
          { key: 'Description', label: 'Adapter', truncate: true },
          { key: 'MACAddress', label: 'MAC', mono: true },
          { key: 'IP', label: 'IP', mono: true },
          { key: 'Gateway', label: 'Gateway', mono: true },
          { key: 'DHCP', label: 'DHCP' },
        ],
      },
    ],
  },
  {
    id: 'software',
    label: 'Software',
    subviews: [
      {
        id: 'apps',
        label: 'Installed',
        source: { kind: 'inventory', key: 'apps' },
        columns: [
          { key: 'DisplayName', label: 'Name', truncate: true },
          { key: 'DisplayVersion', label: 'Version' },
          { key: 'Publisher', label: 'Publisher', truncate: true },
          { key: 'InstallDate', label: 'Installed' },
        ],
        action: {
          label: 'uninstall',
          danger: true,
          confirm: (r) => `Uninstall ${r.DisplayName}?`,
          command: (r) => {
            const guid = /\{[0-9A-Fa-f-]+\}/.exec(r.Uninstall || '')
            return guid
              ? `msiexec /x ${guid[0]} /qn /norestart`
              : r.Uninstall || 'Write-Output "no uninstall string"'
          },
        },
      },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    subviews: [
      {
        id: 'antivirus',
        label: 'AV / EDR',
        source: { kind: 'av' },
        columns: [
          { key: 'Product', label: 'Product' },
          { key: 'Status', label: 'Status' },
          { key: 'Via', label: 'Detected via' },
        ],
      },
      {
        id: 'firewall',
        label: 'Firewall',
        source: { kind: 'live', cmd: FW_CMD },
        columns: [
          { key: 'Name', label: 'Profile' },
          { key: 'Enabled', label: 'Status', format: yesNo },
        ],
      },
      {
        id: 'bitlocker',
        label: 'BitLocker',
        source: { kind: 'live', cmd: BL_CMD },
        columns: [
          { key: 'Volume', label: 'Volume' },
          { key: 'Protection', label: 'Protection' },
          { key: 'Status', label: 'Status', format: spaced },
          { key: 'Encryption', label: 'Encryption method', format: spaced },
          { key: 'Lock', label: 'Lock status', format: spaced },
          { key: 'Type', label: 'Volume type', format: spaced },
          { key: 'Percent', label: 'Encryption %', align: 'right' },
        ],
      },
    ],
  },
  {
    id: 'events',
    label: 'Events',
    subviews: [
      {
        id: 'log-application',
        label: 'Application',
        source: { kind: 'live', cmd: eventLogCmd('Application') },
        columns: EVT_COLS,
        detailKey: 'Message',
      },
      {
        id: 'log-security',
        label: 'Security',
        source: { kind: 'live', cmd: eventLogCmd('Security') },
        columns: EVT_COLS,
        detailKey: 'Message',
      },
      {
        id: 'log-system',
        label: 'System',
        source: { kind: 'live', cmd: eventLogCmd('System') },
        columns: EVT_COLS,
        detailKey: 'Message',
      },
    ],
  },
]
