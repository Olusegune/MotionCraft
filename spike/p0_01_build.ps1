<#
P0-01 / criterion 7: build effectcraft + effectcraft-cli at the pin, twice from clean, record times and hashes.
Usage: powershell -File spike\p0_01_build.ps1 [-EffectCraftDir ..\effectcraft] [-Repeat 2]
Writes spike\results\p0_01_build_<os>.json. Never pushes to the effectcraft repo; build output stays in its target/.
#>
param(
  [string]$EffectCraftDir = (Join-Path $PSScriptRoot '..\..\effectcraft'),
  [int]$Repeat = 2
)
$ErrorActionPreference = 'Stop'
$pin = '7e2d0256209974ffb92a29d8bdb6f2a49078f51f'
$ec = (Resolve-Path $EffectCraftDir).Path
$head = (git -C $ec rev-parse HEAD).Trim()
if ($head -ne $pin) { throw "effectcraft is at $head, expected pin $pin" }
$dirty = git -C $ec status --porcelain
if ($dirty) { throw "effectcraft working tree is not clean:`n$dirty" }

$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpu = (Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name) ($($_.DriverVersion))" }) -join '; '
$os = Get-CimInstance Win32_OperatingSystem
$machine = [ordered]@{
  os = "$($os.Caption) build $($os.BuildNumber)"
  cpu = "$($cpu.Name), $($cpu.NumberOfCores) cores / $($cpu.NumberOfLogicalProcessors) threads"
  gpu = $gpu
  ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
  rustc = (rustc -V); cargo = (cargo -V)
  rustHost = ((rustc -vV | Select-String '^host:').Line -replace 'host:\s*', '')
}
$exe = if ($IsLinux -or $IsMacOS) { '' } else { '.exe' }
$outDir = Join-Path $PSScriptRoot 'results'
New-Item -ItemType Directory -Force $outDir | Out-Null
$runs = @()
Push-Location $ec
try {
  for ($i = 1; $i -le $Repeat; $i++) {
    cargo clean | Out-Null
    $sw = [Diagnostics.Stopwatch]::StartNew()
    cargo build --release --locked -p effectcraft-cli -p effectcraft
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed on run $i" }
    $sw.Stop()
    $bins = @{}
    foreach ($b in 'effectcraft-cli', 'effectcraft') {
      $p = "target\release\$b$exe"
      $bins[$b] = [ordered]@{ sha256 = (Get-FileHash $p -Algorithm SHA256).Hash.ToLower(); bytes = (Get-Item $p).Length }
    }
    $runs += [ordered]@{ run = $i; wallSeconds = [math]::Round($sw.Elapsed.TotalSeconds, 1); binaries = $bins
      version = (& ".\target\release\effectcraft-cli$exe" --version) }
    if ($i -eq $Repeat) { } # keep the last build in target/ for later spikes
  }
} finally { Pop-Location }
$same = ($runs | ForEach-Object { $_.binaries.'effectcraft-cli'.sha256 } | Select-Object -Unique).Count -eq 1 -and
        ($runs | ForEach-Object { $_.binaries.effectcraft.sha256 } | Select-Object -Unique).Count -eq 1
$result = [ordered]@{ pin = $pin; machine = $machine; runs = $runs; identicalHashes = $same
  recordedAt = (Get-Date).ToUniversalTime().ToString('o') }
$name = if ($IsLinux) { 'linux' } elseif ($IsMacOS) { 'macos' } else { 'windows' }
$result | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $outDir "p0_01_build_$name.json")
$result | ConvertTo-Json -Depth 6
