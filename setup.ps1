# PhoneDesk for Windows 10/11: fetch, verify, install and start it from one command.
# This is the nguyentienanhvtth fork — it fetches releases from nguyentienanhvtth/phonedesk only.
#
# Usage
#   irm https://raw.githubusercontent.com/nguyentienanhvtth/phonedesk/main/setup.ps1 | iex
#
# Run it from a normal PowerShell window. Only the optional firewall rule needs administrator rights, and Windows asks
# for those itself (UAC). Run it again any time to upgrade; %USERPROFILE%\.phonedesk is never wiped.
#
# `irm | iex` cannot take parameters, so every switch has an environment twin:
#
#   Environment variable            Effect
#   $env:PHONEDESK_YES=1            take every default, ask nothing
#   $env:PHONEDESK_VERSION=0.2.0    install that release, not the newest
#   $env:PHONEDESK_FORCE=1          reinstall even if this release is already in place
#   $env:PHONEDESK_PORT=7420        port for the agent
#   $env:PHONEDESK_NO_AUTOSTART=1   skip the sign-in scheduled task
#   $env:PHONEDESK_NO_START=1       place the program only, do not launch it
#   $env:PHONEDESK_NO_OPEN=1        do not open the manage page afterwards
#   $env:PHONEDESK_NO_FIREWALL=1    do not offer the firewall rule
#   $env:PHONEDESK_NO_PATH=1        leave PATH alone
#   $env:PHONEDESK_DRY_RUN=1        fetch and verify, say what would change, change nothing
#
# Prefer parameters? Save the file, set $env:PHONEDESK_SETUP_NORUN=1, dot-source it, then call
#   Install-PhoneDesk -Yes -Port 7421
#
# Test hooks (not for everyday use)
#   PHONEDESK_RELEASE_BASE   folder or URL holding phonedesk-windows-x64.exe and SHA256SUMS
#   PHONEDESK_INSTALL_HOME   install below this folder instead of %LOCALAPPDATA% / %USERPROFILE%
#   PHONEDESK_GITHUB_URL / PHONEDESK_API_URL   point the "newest release" lookup at a local server
#   PHONEDESK_RETRY_SECONDS  scales the pause between lookup rounds

function Install-PhoneDesk {
  [CmdletBinding()]
  param(
    [switch]$Yes, [string]$Version = '', [int]$Port = 7420, [switch]$NoAutostart, [switch]$NoStart,
    [switch]$NoOpen, [switch]$NoFirewall, [switch]$NoPath, [switch]$DryRun, [switch]$Force
  )
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest crawl in Windows PowerShell 5.1
  # This fork fetches releases from nguyentienanhvtth/phonedesk, never from the upstream howznguyen/phonedesk.
  $repo = 'nguyentienanhvtth/phonedesk'
  $asset = 'phonedesk-windows-x64.exe'
  $stages = 6

  # state shared between phases (a hashtable, so nested functions can change it)
  $S = @{
    tmp = $null; base = $null; tag = $null; custom = $false
    newVersion = $null; oldVersion = $null; upToDate = $false; dryDone = $false
    alreadyRunning = $false; svcBefore = $false; svcKeep = $false; autostart = $false
    binState = 'already set'; pathState = 'skipped'; svcState = 'skipped'; fwState = 'skipped'
    pathAdded = $false; pairing = $null
  }

  # ------------------------------------------------------------ terminal look
  # Glyphs only when the console really speaks UTF-8; otherwise plain ASCII. Colour unless NO_COLOR is set.
  $utf = $false
  try { $utf = ([Console]::OutputEncoding.CodePage -eq 65001) } catch { }
  $G = if ($utf) { @{ ok = [string][char]0x2713; warn = '!'; bad = [string][char]0x2717; arrow = [string][char]0x2192 } } else { @{ ok = 'ok'; warn = '!'; bad = 'x'; arrow = '->' } }
  $useColor = -not $env:NO_COLOR
  function Put([string]$text, [string]$color) {
    if ($useColor -and $color) { Write-Host $text -ForegroundColor $color } else { Write-Host $text }
  }
  function Say([string]$m) { Put "  $m" '' }
  function Good([string]$m) { Put "  $($G.ok) $m" 'Green' }
  function Warn([string]$m) { Put "  $($G.warn) $m" 'Yellow' }
  function Stage([int]$n, [string]$title) { Write-Host ''; Put "[$n/$stages] $title" 'Cyan' }
  function Fail([string]$what, [string]$why) {
    Write-Host ''
    Put "$($G.bad) $what" 'Red'
    if ($why) { Put "  $why" '' }
    Write-Host ''
    Put "  Need help? https://github.com/$repo/issues" ''
    throw "PhoneDesk setup failed: $what"
  }
  function Show-Banner {
    Write-Host ''
    if ($utf) {
      $tl = [char]0x256D; $tr = [char]0x256E; $bl = [char]0x2570; $br = [char]0x256F; $h = [string][char]0x2500; $v = [char]0x2502
      Put ("  $tl" + ($h * 6) + "$tr") 'Cyan'
      Put "  $v $([char]0x25C9)  $([char]0x25AD) $v  PhoneDesk" 'Cyan'
      Put ("  $bl" + ($h * 6) + "$br  installer for Windows") 'Cyan'
    } else {
      Put '  +------+' 'Cyan'
      Put '  | o  = |  PhoneDesk' 'Cyan'
      Put '  +------+  installer for Windows' 'Cyan'
    }
  }
  function Ask([string]$question, [bool]$default) {
    $hint = if ($default) { '[Y/n]' } else { '[y/N]' }
    if ($Yes -or -not [Environment]::UserInteractive -or [Console]::IsInputRedirected) {
      Say "$question $hint $($G.arrow) $(if ($default) { 'yes' } else { 'no' }) (default)"
      return $default
    }
    while ($true) {
      $a = (Read-Host "  $question $hint").Trim()
      if ($a -eq '') { return $default }
      if ($a -match '^(y|yes)$') { return $true }
      if ($a -match '^(n|no)$') { return $false }
    }
  }

  try {
    # Windows PowerShell 5.1 may still default to TLS 1.0, which GitHub refuses
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
    if ($Port -lt 1 -or $Port -gt 65535) { Fail '-Port must be between 1 and 65535' '' }

    # ------------------------------------------------------------ where everything lives
    $relocated = [bool]$env:PHONEDESK_INSTALL_HOME
    if ($relocated) {
      $installHome = $env:PHONEDESK_INSTALL_HOME
      $binDir = Join-Path $installHome 'bin'
      $dataDir = Join-Path $installHome '.phonedesk'
      $svcDir = Join-Path $installHome 'service'
    } else {
      $local = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }
      $binDir = Join-Path $local 'PhoneDesk\bin'
      $dataDir = Join-Path $env:USERPROFILE '.phonedesk'
      $svcDir = Join-Path $local 'PhoneDesk'
    }
    $exe = Join-Path $binDir 'phonedesk.exe'
    $releaseFile = Join-Path $binDir '.release'
    $launcher = Join-Path $svcDir 'launch.vbs'
    $logDir = Join-Path $dataDir 'logs'
    # A relocated install (tests) keeps every file the program touches inside it.
    $childEnv = @{ PHONEDESK_HOME = $dataDir }
    if ($relocated) {
      $childEnv['PHONEDESK_WIN_DIR'] = $svcDir
      $childEnv['PHONEDESK_CLAUDE_DIR'] = if ($env:PHONEDESK_CLAUDE_DIR) { $env:PHONEDESK_CLAUDE_DIR } else { Join-Path $installHome '.claude' }
      $childEnv['PHONEDESK_CODEX_DIR'] = if ($env:PHONEDESK_CODEX_DIR) { $env:PHONEDESK_CODEX_DIR } else { Join-Path $installHome '.codex' }
    } elseif ($env:PHONEDESK_HOME) {
      $childEnv['PHONEDESK_HOME'] = $env:PHONEDESK_HOME
    }
    function Run-Bin([string]$file, [string[]]$arguments, [switch]$Quiet) {
      # runs the program with PhoneDesk's environment; returns its exit code (output shown unless -Quiet)
      $saved = @{}
      foreach ($k in $childEnv.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process'); [Environment]::SetEnvironmentVariable($k, $childEnv[$k], 'Process') }
      $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue' # a native program writing to stderr must not abort us
      try {
        $out = & $file @arguments 2>&1
        $code = $LASTEXITCODE
        if (-not $Quiet) { foreach ($l in $out) { Say "$l" } }
        return $code
      } finally {
        $ErrorActionPreference = $ea
        foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
      }
    }
    function Sha([string]$f) { return (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant() }
    function VerOf([string]$line) { if ($line -match '^phonedesk (\S+)') { return $Matches[1] }; return '' }
    function Version-Line([string]$file) {
      $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { return (& $file --version 2>$null | Select-Object -First 1) } catch { return $null } finally { $ErrorActionPreference = $ea }
    }
    function Agent-Line([int]$p) { # what the agent on a port says about itself, $null when silent
      try {
        $ab = Invoke-RestMethod -Uri "http://127.0.0.1:$p/api/about" -Headers @{ 'x-phonedesk' = '1' } -TimeoutSec 2
        $line = "phonedesk $($ab.version)"
        if ($ab.commit) { $line += " ($($ab.commit)$(if ($ab.dirty) { '-dirty' }))" }
        return $line
      } catch { return $null }
    }

    # ============================================================ phase 1: detect platform
    function Detect-Platform {
      Stage 1 'Checking this PC'
      if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { Fail "this installer only runs on Windows" '' }
      if (-not [Environment]::Is64BitOperatingSystem) { Fail 'PhoneDesk needs 64-bit Windows 10 or 11' '' }
      $os = [Environment]::OSVersion.Version
      if ($os.Major -lt 10) { Fail "PhoneDesk needs Windows 10 or 11" "This is $($os.ToString())." }
      if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and -not $relocated) {
        # With UAC off (EnableLUA=0) every process of an administrator account is elevated and there is no normal window to
        # switch to: installing for this user is the only option, so carry on without asking.
        $uacOff = $false
        try { $uacOff = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -ErrorAction Stop).EnableLUA -eq 0 } catch { }
        if ($uacOff) {
          Say 'UAC is off on this PC, so PowerShell always runs elevated; installing for this user.'
        } else {
          Warn 'This window is elevated. PhoneDesk should run as your own user; a normal PowerShell window is better.'
          if (-not (Ask 'Continue anyway?' $false)) { Fail 'cancelled' 'Nothing was installed.' }
        }
      }
      Good "Windows $($os.Major).$($os.Build) x64 $($G.arrow) $asset"
    }

    # ============================================================ phase 2: resolve release
    function Resolve-Release {
      Stage 2 'Finding the release'
      $S.tmp = Join-Path ([IO.Path]::GetTempPath()) ('phonedesk-setup-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
      New-Item -ItemType Directory -Path $S.tmp | Out-Null
      if ($env:PHONEDESK_RELEASE_BASE) {
        $S.base = $env:PHONEDESK_RELEASE_BASE.TrimEnd('/', '\')
        $S.custom = $true
        Good "using PHONEDESK_RELEASE_BASE ($($S.base))"
        return
      }
      $ghUrl = if ($env:PHONEDESK_GITHUB_URL) { $env:PHONEDESK_GITHUB_URL.TrimEnd('/') } else { 'https://github.com' }
      if ($env:PHONEDESK_GITHUB_URL) { $S.custom = $true }
      if ($Version) {
        $S.tag = 'v' + $Version.TrimStart('v')
      } else {
        # GitHub answers 5xx now and then: redirect lookup, then the API, 4 rounds with a growing pause.
        $apiUrl = if ($env:PHONEDESK_API_URL) { $env:PHONEDESK_API_URL.TrimEnd('/') } else { 'https://api.github.com' }
        $pause = if ($env:PHONEDESK_RETRY_SECONDS) { [int]$env:PHONEDESK_RETRY_SECONDS } else { 2 }
        $tag = $null; $why = ''
        for ($round = 1; $round -le 4 -and -not $tag; $round++) {
          try {
            $req = [Net.HttpWebRequest]::Create("$ghUrl/$repo/releases/latest")
            $req.Method = 'HEAD'; $req.UserAgent = 'phonedesk-setup'; $req.Timeout = 15000
            $resp = $req.GetResponse()
            $tag = ($resp.ResponseUri.AbsoluteUri -split '/tag/')[1]
            $resp.Close()
          } catch { $why = "github.com: $($_.Exception.Message)"; $tag = $null }
          if (-not $tag) {
            try {
              $rq = [Net.HttpWebRequest]::Create("$apiUrl/repos/$repo/releases/latest")
              $rq.UserAgent = 'phonedesk-setup'; $rq.Accept = 'application/vnd.github+json'; $rq.Timeout = 15000
              $rs = $rq.GetResponse()
              $sr = New-Object IO.StreamReader($rs.GetResponseStream())
              try { $tag = [string](($sr.ReadToEnd() | ConvertFrom-Json).tag_name) } finally { $sr.Dispose(); $rs.Close() }
              if (-not $tag) { $tag = $null }
            } catch { $why = "$why; api.github.com: $($_.Exception.Message)"; $tag = $null }
          }
          if (-not $tag -and $round -lt 4) { Warn "GitHub did not answer ($why); retrying..."; Start-Sleep -Seconds ($round * $pause) }
        }
        if (-not $tag) { Fail "couldn't look up the latest release of $repo" "$why - check your connection and run it again, or pin a release with `$env:PHONEDESK_VERSION='0.1.1'." }
        $S.tag = $tag
      }
      $S.base = "$ghUrl/$repo/releases/download/$($S.tag)"
      Good "using release $($S.tag)"
    }

    # ============================================================ downloading helpers
    function Fetch([string]$src, [string]$dest) {
      if ($src -match '^https?://') {
        if (-not $S.custom -and $src -notmatch '^https://') { throw 'refusing a non-https download' }
        for ($try = 1; $try -le 3; $try++) {
          try { Invoke-WebRequest -Uri $src -OutFile $dest -UseBasicParsing -UserAgent 'phonedesk-setup'; break }
          catch { if ($try -ge 3 -or $_.Exception.Message -match '404|Not Found') { throw }; Start-Sleep -Seconds 2 }
        }
      } else {
        if (-not (Test-Path -LiteralPath $src)) { throw "not found: $src" }
        Copy-Item -LiteralPath $src -Destination $dest
      }
    }
    function Sum-For([string]$name) { # the sha256 SHA256SUMS lists for a file name, $null if absent
      foreach ($line in $S.sumLines) {
        $m = [regex]::Match($line, '^\s*([0-9a-fA-F]{64})\s+\*?(.+?)\s*$')
        if ($m.Success -and $m.Groups[2].Value -eq $name) { return $m.Groups[1].Value.ToLowerInvariant() }
      }
      return $null
    }
    function Sum-Check([string]$file, [string]$name) {
      $want = Sum-For $name
      if (-not $want) { Fail "$name has no entry in SHA256SUMS" 'Refusing to install a file that cannot be verified.' }
      $got = Sha $file
      if ($got -ne $want) { Fail "checksum mismatch for $name" "Expected $want but got $got. Nothing was installed." }
      Good "$name checksum ok ($($got.Substring(0, 16))...)"
    }
    function Size-Hint([string]$src) {
      $bytes = 0
      try {
        if ($src -match '^https?://') {
          $rq = [Net.HttpWebRequest]::Create($src); $rq.Method = 'HEAD'; $rq.UserAgent = 'phonedesk-setup'; $rq.Timeout = 15000
          $rs = $rq.GetResponse(); $bytes = $rs.ContentLength; $rs.Close()
        } elseif (Test-Path -LiteralPath $src) { $bytes = (Get-Item -LiteralPath $src).Length }
      } catch { }
      if ($bytes -gt 0) { return " ($([math]::Ceiling($bytes / 1MB)) MB)" }
      return ''
    }
    # Big files: a progress line on a terminal, quiet otherwise. When nothing arrives for 60 s the attempt is dropped and
    # resumed with a Range request, up to 5 times.
    function Fetch-Big([string]$src, [string]$dest) {
      if ($src -notmatch '^https?://') { Fetch $src $dest; return }
      if (-not $S.custom -and $src -notmatch '^https://') { throw 'refusing a non-https download' }
      $stall = if ($env:PHONEDESK_STALL_SECONDS) { [int]$env:PHONEDESK_STALL_SECONDS } else { 60 }
      $show = -not [Console]::IsOutputRedirected
      if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
      for ($try = 1; $try -le 5; $try++) {
        $have = if (Test-Path -LiteralPath $dest) { (Get-Item -LiteralPath $dest).Length } else { 0 }
        $rs = $null; $in = $null; $out = $null
        try {
          $rq = [Net.HttpWebRequest]::Create($src); $rq.UserAgent = 'phonedesk-setup'; $rq.ReadWriteTimeout = $stall * 1000; $rq.Timeout = $stall * 1000
          if ($have -gt 0) { $rq.AddRange([int64]$have) }
          $rs = $rq.GetResponse()
          $resumed = ($have -gt 0 -and [int]$rs.StatusCode -eq 206)
          $total = if ($rs.ContentLength -gt 0) { $rs.ContentLength + $(if ($resumed) { $have } else { 0 }) } else { 0 }
          $out = [IO.File]::Open($dest, $(if ($resumed) { 'Append' } else { 'Create' }), 'Write')
          $in = $rs.GetResponseStream()
          $buf = New-Object byte[] 262144
          $done = if ($resumed) { $have } else { 0 }; $last = [DateTime]::UtcNow
          while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
            $out.Write($buf, 0, $n); $done += $n
            if ($show -and ([DateTime]::UtcNow - $last).TotalMilliseconds -gt 250) {
              $last = [DateTime]::UtcNow
              $pct = if ($total -gt 0) { [int](100 * $done / $total) } else { 0 }
              Write-Host -NoNewline ("`r  {0,3}%  {1:N1} / {2:N1} MB   " -f $pct, ($done / 1MB), ($total / 1MB))
            }
          }
          if ($show) { Write-Host '' }
          return
        } catch {
          if ($show) { Write-Host '' }
          $msg = $_.Exception.Message
          if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
          if ($msg -match '404|403|Not Found') { throw }
          Warn "no data for a while or the connection dropped ($msg); resuming from where it stopped ($try/5)"
          Start-Sleep -Seconds 2
        } finally { foreach ($x in @($in, $out, $rs)) { if ($x) { try { $x.Dispose() } catch { } } } }
      }
      Say "Tip: try later, another network or a VPN, or fetch $src by hand and point PHONEDESK_RELEASE_BASE at that folder."
      throw 'download failed'
    }

    # ============================================================ phase 3: fetch binary
    $dl = $null
    function Probe-Installed {
      # A previous install leaves .release holding the sha256 of the release file it came from and of the file on disk.
      # Same release sum + untouched file + it still runs = nothing to download.
      $S.oldVersion = $null
      if (Test-Path -LiteralPath $exe) { $S.oldVersion = Version-Line $exe }
      $S.upToDate = $false
      $wantRaw = Sum-For $asset
      if (-not $Force -and $S.oldVersion -and $wantRaw -and (Test-Path -LiteralPath $releaseFile)) {
        $rel = Get-Content -LiteralPath $releaseFile -Raw
        if ($rel -match '(?m)^raw=([0-9a-f]+) installed=([0-9a-f]+)' -and $Matches[1] -eq $wantRaw -and $Matches[2] -eq (Sha $exe)) { $S.upToDate = $true }
      }
    }
    function Fetch-Binary {
      Stage 3 'Getting the program'
      $sums = Join-Path $S.tmp 'SHA256SUMS'
      try { Fetch "$($S.base)/SHA256SUMS" $sums } catch { Fail "could not fetch $($S.base)/SHA256SUMS" "$($_.Exception.Message) - check the release exists and that you are online." }
      $S.sumLines = @(Get-Content -LiteralPath $sums)
      Probe-Installed
      if ($S.upToDate) {
        $S.newVersion = $S.oldVersion
        Good "PhoneDesk $(VerOf $S.oldVersion) is up to date (checksum verified), skipping the download"
        return
      }
      # Releases carry a gzip of the program (a third of the size); older ones only the plain .exe.
      $got = $false
      if (Sum-For "$asset.gz") {
        $gz = Join-Path $S.tmp "$asset.gz"
        Say "Fetching $asset.gz$(Size-Hint "$($S.base)/$asset.gz")"
        try {
          Fetch-Big "$($S.base)/$asset.gz" $gz
          Sum-Check $gz "$asset.gz"
          $inS = [IO.File]::OpenRead($gz); $zs = New-Object IO.Compression.GZipStream($inS, [IO.Compression.CompressionMode]::Decompress); $outS = [IO.File]::Create($dl)
          try { $zs.CopyTo($outS) } finally { $outS.Dispose(); $zs.Dispose(); $inS.Dispose() }
          Remove-Item -LiteralPath $gz -Force -ErrorAction SilentlyContinue
          $got = $true
        } catch {
          if ($_.Exception.Message -match 'checksum mismatch') { throw }
          Warn "the compressed download failed ($($_.Exception.Message)); falling back to the uncompressed program"
          Remove-Item -LiteralPath $gz, $dl -Force -ErrorAction SilentlyContinue
        }
      }
      if (-not $got) {
        Say "Fetching $asset$(Size-Hint "$($S.base)/$asset")"
        try { Fetch-Big "$($S.base)/$asset" $dl } catch { Fail "could not fetch $($S.base)/$asset" $_.Exception.Message }
      }
    }

    # ============================================================ phase 3b: verify binary
    function Verify-Binary {
      if ($S.upToDate) { return }
      Sum-Check $dl $asset # always the program itself, however it arrived
      Unblock-File -LiteralPath $dl -ErrorAction SilentlyContinue # no "from the internet" mark: SmartScreen stays quiet
      $v = $null
      $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { $v = (& $dl --version 2>$null | Select-Object -First 1) } catch { }
      $ErrorActionPreference = $ea
      if (-not $v) { Fail 'the downloaded program does not run on this PC' 'It printed no version.' }
      $S.newVersion = $v
      Good "$v"
    }

    # ============================================================ phase 4: place binary
    function Place-Binary {
      Stage 4 'Installing'
      Say "program   $exe"
      Say "your data stays in $dataDir"
      if (-not $S.upToDate -and $S.oldVersion) { Say "upgrading from $($S.oldVersion)" }
      if ($DryRun) {
        Warn 'dry run: nothing was installed, started or changed'
        if (-not $NoAutostart) { Say 'would create the scheduled task "PhoneDesk" (starts when you sign in)' }
        if (-not $NoFirewall) { Say 'would offer a firewall rule for phonedesk.exe, local network only (one UAC prompt)' }
        Say "would start PhoneDesk on port $Port and open http://localhost:$Port/manage/"
        $S.dryDone = $true
        return
      }
      $S.svcBefore = (Test-Path -LiteralPath $launcher)
      if ($S.upToDate) { $S.binState = 'already set'; return }
      if (-not (Ask "Install PhoneDesk to ${exe}?" $true)) { Fail 'cancelled' 'Nothing was installed.' }
      $S.binState = if ($S.oldVersion) { "updated ($(VerOf $S.oldVersion) -> $(VerOf $S.newVersion))" } else { 'installed' }
      # let go of the old file: the scheduled task first, then an agent started by hand
      if (Test-Path -LiteralPath $exe) {
        [void](Run-Bin $exe @('service', 'uninstall') -Quiet)
        Get-Process -Name phonedesk -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 700
      }
      New-Item -ItemType Directory -Force -Path $binDir, $logDir | Out-Null
      $staged = Join-Path $binDir '.phonedesk.new.exe'
      Copy-Item -LiteralPath $dl -Destination $staged -Force
      Move-Item -LiteralPath $staged -Destination $exe -Force
      "raw=$(Sum-For $asset) installed=$(Sha $exe)" | Set-Content -LiteralPath $releaseFile -Encoding ascii
      Good "installed $($S.newVersion)"
    }

    # ============================================================ phase 4b: link cli (PATH)
    function Link-Cli {
      if ($NoPath -or $relocated) { return }
      $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      $parts = @($userPath -split ';' | Where-Object { $_ })
      if ($parts -notcontains $binDir) {
        # SetEnvironmentVariable writes HKCU\Environment and broadcasts WM_SETTINGCHANGE, so new terminals see it
        [Environment]::SetEnvironmentVariable('Path', (($parts + $binDir) -join ';'), 'User')
        $S.pathAdded = $true; $S.pathState = 'installed'
        Good 'phonedesk is on your PATH'
      } else { $S.pathState = 'already set'; Say 'phonedesk is already on PATH' }
      if ($env:Path -notlike "*$binDir*") { $env:Path = "$env:Path;$binDir" } # this window too
    }

    # ============================================================ phase 5: wire service (+ firewall)
    function Service-Current {
      if (-not (Test-Path -LiteralPath $launcher)) { return $false }
      $rel = if (Test-Path -LiteralPath $releaseFile) { Get-Content -LiteralPath $releaseFile -Raw } else { '' }
      if (-not ($rel -match '(?m)^svc=([0-9a-f]+)') -or $Matches[1] -ne (Sha $launcher)) { return $false }
      $txt = Get-Content -LiteralPath $launcher -Raw
      if ($Port -eq 7420) { if ($txt -match '--port') { return $false } } elseif ($txt -notmatch "--port\W+$Port\b") { return $false }
      $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { & schtasks.exe /Query /TN PhoneDesk *> $null; return ($LASTEXITCODE -eq 0) } finally { $ErrorActionPreference = $ea }
    }
    function Firewall-Rule {
      if ($NoFirewall -or $NoStart) { return }
      # BEFORE the first start: a program that listens without a rule makes Windows show a popup and, unanswered, create
      # BLOCK rules that beat any allow rule.
      $has = $false; $blocked = $false
      try {
        $rules = @(Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' })
        $has = [bool]($rules | Where-Object { $_.Action -eq 'Allow' })
        $blocked = [bool]($rules | Where-Object { $_.Action -eq 'Block' })
      } catch { }
      if ($has -and -not $blocked) { Good 'firewall already allows phonedesk.exe'; $S.fwState = 'already set'; return }
      Say 'Windows blocks incoming connections by default, so a phone on your Wi-Fi could not reach PhoneDesk.'
      if ($blocked) { Warn 'There are BLOCK rules for phonedesk.exe (from an unanswered firewall popup); the same step removes them.' }
      Say 'One inbound rule for phonedesk.exe, local subnet only (any profile, nothing from the internet). Windows will ask permission (UAC).'
      if (Ask 'Add the firewall rule?' $true) {
        $rule = "netsh advfirewall firewall delete rule name=all program=`"$exe`" >nul 2>&1 & netsh advfirewall firewall add rule name=`"PhoneDesk`" dir=in action=allow program=`"$exe`" profile=any remoteip=localsubnet enable=yes"
        try {
          $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $rule) -Verb RunAs -Wait -PassThru -WindowStyle Hidden
          if ($p.ExitCode -eq 0) { Good 'firewall rule added (local subnet only)'; $S.fwState = 'installed' } else { Warn "netsh returned $($p.ExitCode); run `phonedesk doctor` for what to do" }
        } catch { Warn 'the permission prompt was declined, so no rule was added. `phonedesk doctor` shows how to add it later.' }
      } else {
        Say 'Skipped. Without the rule your phone cannot connect; `phonedesk doctor` shows the command to add it later.'
      }
    }
    function Preflight-Port {
      # something else on the port would answer the health check below: stop and say who
      $holder = $null
      try { $holder = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1 } catch { }
      $S.alreadyRunning = $false
      if (-not $holder) { return }
      if ($S.upToDate -and (Agent-Line $Port) -eq $S.newVersion) { $S.alreadyRunning = $true; Say "agent already running on port $Port"; return }
      $hp = $null; try { $hp = Get-Process -Id $holder.OwningProcess -ErrorAction Stop } catch { }
      $who = if ($hp) { "$($hp.ProcessName) (pid $($hp.Id)$(if ($hp.Path) { ', ' + $hp.Path }))" } else { "process $($holder.OwningProcess)" }
      Fail "port $Port is taken by $who" "Free it with Stop-Process -Id $($holder.OwningProcess) - or install on another port with `$env:PHONEDESK_PORT=7421. The program is in place at $exe; nothing was started."
    }
    function Wire-Service {
      Stage 5 'Background service and firewall'
      Link-Cli
      $S.autostart = -not $NoAutostart
      if ($S.autostart -and $S.upToDate -and (Service-Current)) { $S.svcKeep = $true }
      elseif ($S.autostart) { if (-not (Ask 'Start PhoneDesk automatically when you sign in?' $true)) { $S.autostart = $false } }
      Firewall-Rule
      if (-not $NoStart) { Preflight-Port }
      if ($S.autostart -and $S.svcKeep) {
        $S.svcState = 'already set'
        Good "service already registered (same program, port $Port), leaving it alone"
      } elseif ($S.autostart) {
        $svcArgs = @('service', 'install')
        if ($Port -ne 7420) { $svcArgs += @('--port', "$Port") }
        if ((Run-Bin $exe $svcArgs) -eq 0) {
          Good "sign-in task registered; it restarts after a crash (logs: $logDir)"
          $S.svcState = if ($S.svcBefore) { 'updated' } else { 'installed' }
          if ((Test-Path -LiteralPath $releaseFile) -and (Test-Path -LiteralPath $launcher)) {
            $keep = @(Get-Content -LiteralPath $releaseFile | Where-Object { $_ -notmatch '^svc=' })
            ($keep + "svc=$(Sha $launcher)") | Set-Content -LiteralPath $releaseFile -Encoding ascii
          }
        } else {
          Warn 'could not register the scheduled task; starting without it'
          $S.autostart = $false
        }
      } else {
        Say 'no sign-in task (skipped)'
      }
      # make sure Claude/Codex hooks that already exist point at this program
      [void](Run-Bin $exe @('hooks', 'repoint', '--port', "$Port") -Quiet)
    }

    # ============================================================ phase 6: launch
    function Launch-Agent {
      Stage 6 'Starting PhoneDesk'
      if ($NoStart) { Say "not started (PHONEDESK_NO_START). Start it with: $exe"; return }
      if (-not $S.autostart -and -not $S.alreadyRunning) {
        $saved = @{}
        foreach ($k in $childEnv.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process'); [Environment]::SetEnvironmentVariable($k, $childEnv[$k], 'Process') }
        try {
          [void](Start-Process -FilePath $exe -ArgumentList @('--port', "$Port") -WindowStyle Hidden -WorkingDirectory $dataDir -RedirectStandardOutput (Join-Path $logDir 'agent.out.log') -RedirectStandardError (Join-Path $logDir 'agent.err.log'))
        } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') } }
      }
      $pairing = $null
      for ($i = 0; $i -lt 40; $i++) {
        try { $pairing = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/pairing" -Headers @{ 'x-phonedesk' = '1' } -TimeoutSec 2; break } catch { Start-Sleep -Milliseconds 500 }
      }
      if (-not $pairing) { Fail "PhoneDesk did not answer on port $Port" "See $logDir\agent.err.log" }
      # the answer could come from ANOTHER process on that port: it must be the build installed a moment ago
      $seen = $null
      for ($i = 0; $i -lt 20; $i++) {
        $seen = Agent-Line $Port
        if ($seen -eq $S.newVersion) { break }
        Start-Sleep -Milliseconds 500
      }
      if ($seen -ne $S.newVersion) {
        $tail = ''; try { $tail = ((Get-Content -LiteralPath (Join-Path $logDir 'agent.err.log') -Tail 8 -ErrorAction Stop) -join [Environment]::NewLine) } catch { }
        Fail "the agent on port $Port is not the one just installed" "It reports '$seen' but we installed '$($S.newVersion)'. Another PhoneDesk probably owns the port: stop it, or use another port. Last log lines ($logDir\agent.err.log):$([Environment]::NewLine)$tail"
      }
      $S.pairing = $pairing
      Good "agent is up on port $Port"
    }

    # ============================================================ summary
    function Show-Summary {
      Write-Host ''
      Put '  -- PhoneDesk ----------------------' 'Cyan'
      Write-Host ('  {0,-9} {1}' -f 'Program', $S.binState)
      Write-Host ('  {0,-9} {1}' -f 'PATH', $S.pathState)
      Write-Host ('  {0,-9} {1}' -f 'Service', $S.svcState)
      Write-Host ('  {0,-9} {1}' -f 'Firewall', $S.fwState)
      if (-not $NoStart -and $S.pairing) {
        Write-Host ('  {0,-9} {1}' -f 'Phone', $S.pairing.url)
        Write-Host ('  {0,-9} {1}' -f 'PIN', $S.pairing.pin)
        Write-Host ('  {0,-9} {1}' -f 'Manage', "http://localhost:$Port/manage/")
      }
      Put '  -----------------------------------' 'Cyan'
      if (-not $NoStart -and $S.pairing) {
        if (-not [Console]::IsOutputRedirected -and $S.pairing.url) { try { Write-Host ''; $qrUrl = if ($S.pairing.urlLocal) { $S.pairing.urlLocal } else { $S.pairing.url }; & $exe qr "$qrUrl" } catch { } }
        Say 'On a phone on the same Wi-Fi, open the Phone address and type the PIN (or scan the code).'
        if (-not $NoOpen -and -not $relocated -and -not ($S.upToDate -and $S.alreadyRunning)) {
          if (Ask 'Open the manage page now?' $true) { try { Start-Process "http://localhost:$Port/manage/" } catch { } }
        }
      }
      if ($S.pathState -eq 'installed') { Say 'New terminal windows will find phonedesk; try: phonedesk doctor   (this window already does)' }
      Say 'Permissions and firewall check, any time: phonedesk doctor'
      Say 'To upgrade, run the same command again. To remove: uninstall.ps1 (see the README).'
    }

    # ============================================================ main
    Show-Banner
    $dl = $null
    Detect-Platform
    Resolve-Release
    $dl = Join-Path $S.tmp $asset
    Fetch-Binary
    Verify-Binary
    Place-Binary
    if ($S.dryDone) { return }
    Wire-Service
    Launch-Agent
    Show-Summary
  } finally {
    if ($S.tmp -and (Test-Path -LiteralPath $S.tmp)) { Remove-Item -LiteralPath $S.tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

if ($env:PHONEDESK_SETUP_NORUN -ne '1') {
  Install-PhoneDesk `
    -Yes:($env:PHONEDESK_YES -eq '1') -Version ([string]$env:PHONEDESK_VERSION) `
    -Port $(if ($env:PHONEDESK_PORT) { [int]$env:PHONEDESK_PORT } else { 7420 }) `
    -NoAutostart:($env:PHONEDESK_NO_AUTOSTART -eq '1') -NoStart:($env:PHONEDESK_NO_START -eq '1') `
    -NoOpen:($env:PHONEDESK_NO_OPEN -eq '1') -NoFirewall:($env:PHONEDESK_NO_FIREWALL -eq '1') `
    -NoPath:($env:PHONEDESK_NO_PATH -eq '1') -DryRun:($env:PHONEDESK_DRY_RUN -eq '1') -Force:($env:PHONEDESK_FORCE -eq '1')
}
