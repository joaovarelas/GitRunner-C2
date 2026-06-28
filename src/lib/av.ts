// AV/EDR product database for client-side detection.
//
// Detection cross-references data already cached on the endpoint tabs:
//   services — from the inventory batch (System > Services)
//   pipes    — from the live Named Pipes subview (System > Named Pipes)
//
// No extra job is triggered for AV detection; it reuses what is already loaded.

export interface AvProduct {
  name: string
  services: string[] // SCM service names; '*' wildcard supported
  pipes: string[]    // named pipe patterns; '*' wildcard supported
}

// PowerShell command for listing named pipes — used by System > Named Pipes
// and shared (same cache key) with the AV/EDR client-side detection.
export const PIPES_CMD = String.raw`Get-ChildItem \\.\pipe\ -ErrorAction SilentlyContinue | Select-Object @{n='Name';e={$_.Name}} | Sort-Object Name | ConvertTo-Json -Compress`

// Case-insensitive match with '*' wildcard support.
function matches(value: string, pattern: string): boolean {
  if (!pattern.includes('*')) return value.toLowerCase() === pattern.toLowerCase()
  const re = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    'i',
  )
  return re.test(value)
}

// Cross-reference endpoint service names and pipe names against AV_PRODUCTS.
// Runs entirely in the browser — no extra CI job needed.
export function detectAv(
  serviceNames: string[],
  pipeNames: string[],
): { Product: string; Status: string; Via: string }[] {
  return AV_PRODUCTS.flatMap((p) => {
    const inst = p.services.some((s) => serviceNames.some((sn) => matches(sn, s)))
    const run = p.pipes.length > 0 && p.pipes.some((pat) => pipeNames.some((pn) => matches(pn, pat)))
    if (!inst && !run) return []
    const status = inst && run ? 'Installed & Running' : inst ? 'Installed' : 'Running (pipe)'
    const via = inst && run ? 'service + pipe' : inst ? 'service' : 'pipe'
    return [{ Product: p.name, Status: status, Via: via }]
  })
}

export const AV_PRODUCTS: AvProduct[] = [
  { name: 'Acronis Cyber Protect',  services: ['AcronisActiveProtectionService'],  pipes: [] },
  { name: 'Avast / AVG',            services: ['AvastWscReporter', 'aswbIDSAgent', 'AVGWscReporter', 'avgbIDSAgent'],  pipes: ['aswCallbackPipe*', 'avgCallbackPipe*'] },
  { name: 'Bitdefender',            services: ['bdredline_agent', 'BDAuxSrv', 'UPDATESRV', 'VSSERV', 'bdredline', 'EPRedline', 'EPUpdateService', 'EPSecurityService', 'EPProtectedService', 'EPIntegrationService'],  pipes: [] },
  { name: 'Carbon Black',           services: ['Parity'],  pipes: [] },
  { name: 'Check Point',            services: ['CPDA', 'vsmon', 'CPFileAnlyz', 'EPClientUIService'],  pipes: [] },
  { name: 'Cortex XDR',             services: ['xdrhealth', 'cyserver'],  pipes: [] },
  { name: 'CrowdStrike Falcon',     services: ['CSFalconService'],  pipes: ['CrowdStrike\\{*'] },
  { name: 'Cybereason',             services: ['CybereasonActiveProbe', 'CybereasonCRS', 'CybereasonBlocki'],  pipes: ['CybereasonAPConsoleMinionHostIpc_*', 'CybereasonAPServerProxyIpc_*'] },
  { name: 'Cynet',                  services: ['CynetLauncher'],  pipes: [] },
  { name: 'Elastic EDR',            services: ['Elastic Agent', 'ElasticEndpoint'],  pipes: ['ElasticEndpointServiceComms-*', 'elastic-agent-system'] },
  { name: 'ESET',                   services: ['ekm', 'epfw', 'epfwlwf', 'epfwwfp', 'EraAgentSvc', 'ERAAgent', 'efwd', 'ehttpsrv'],  pipes: ['nod_scriptmon_pipe'] },
  { name: 'FortiClient',            services: ['FA_Scheduler', 'FCT_SecSvr'],  pipes: ['FortiClient_DBLogDaemon', 'FC_*'] },
  { name: 'FortiEDR',               services: ['FortiEDR Collector Service'],  pipes: [] },
  { name: 'G DATA Security',        services: ['AVKWCtl', 'AVKProxy', 'GDScan'],  pipes: ['exploitProtectionIPC'] },
  { name: 'HarfangLab EDR',         services: ['hurukai', 'Hurukai agent', 'HarfangLab Hurukai agent', 'hurukai-av', 'hurukai-ui'],  pipes: ['hurukai-control', 'hurukai-servicing', 'hurukai-amsi'] },
  { name: 'Ivanti Security',        services: ['STAgent$Shavlik Protect', 'STDispatch$Shavlik Protect'],  pipes: [] },
  { name: 'Kaseya Agent',           services: ['KAENDKSAASC*', 'KAKSAASC*'],  pipes: ['kaseyaUserKSA*', 'kaseyaAgentKSA*'] },
  { name: 'Kaspersky',              services: ['kavfsslp', 'KAVFS', 'KAVFSGT', 'klnagent'],  pipes: ['Exploit_Blocker'] },
  { name: 'Malwarebytes',           services: ['MBAMService', 'MBEndpointAgent'],  pipes: ['MBLG', 'MBEA2_R', 'MBEA2_W'] },
  { name: 'Panda AD360',            services: ['PandaAetherAgent', 'PSUAService', 'NanoServiceMain'],  pipes: ['NNS_API_IPC_SRV_ENDPOINT', 'PSANMSrvcPpal'] },
  { name: 'Rapid7 Insight',         services: ['ir_agent'],  pipes: [] },
  { name: 'SentinelOne',            services: ['SentinelAgent', 'SentinelStaticEngine', 'LogProcessorService'],  pipes: ['SentinelAgentWorkerCert.*', 'DFIScanner.Etw.*', 'DFIScanner.Inline.*'] },
  { name: 'Sophos Intercept X',     services: ['SntpService', 'Sophos Endpoint Defense Service', 'Sophos Health Service', 'Sophos MCS Agent', 'Sophos MCS Client'],  pipes: ['SophosUI', 'SophosEventStore', 'sophos_deviceencryption', 'sophoslivequery_*'] },
  { name: 'Symantec Endpoint',      services: ['SepMasterService', 'SepScanService', 'SNAC'],  pipes: [] },
  { name: 'Trellix / McAfee EDR',   services: ['McAfee Endpoint Security Platform Service', 'mfemactl', 'mfemms', 'mfefire', 'masvc', 'macmnsvc', 'mfetp', 'mfewc', 'mfeaack'],  pipes: ['TrellixEDR_Pipe_*', 'mfemactl_*', 'mfefire_*', 'McAfeeAgent_Pipe_*', 'mfetp_*'] },
  { name: 'Trend Micro',            services: ['Trend Micro Endpoint Basecamp', 'TMBMServer', 'Trend Micro Web Service Communicator', 'TMiACAgentSvc', 'CETASvc', 'iVPAgent', 'ds_agent', 'ds_monitor', 'ds_notifier'],  pipes: ['IPC_XBC_XBC_AGENT_PIPE_*', 'iacagent_*', 'OIPC_LWCS_PIPE_*', 'Log_ServerNamePipe', 'OIPC_NTRTSCAN_PIPE_*'] },
  { name: 'Wazuh',                  services: ['WazuhSvc'],  pipes: [] },
  { name: 'Windows Defender',       services: ['WinDefend', 'Sense', 'WdNisSvc'],  pipes: [] },
  { name: 'WithSecure Elements',    services: ['fsdevcon', 'fshoster', 'fsnethoster', 'fsulhoster', 'fsulnethoster', 'fsulprothoster', 'wsulavprohoster'],  pipes: ['FS_CCFIPC_*'] },
]
