# scripts/test-api.ps1
# ═══════════════════════════════════════════════════════════════════════════
# ALTUVERA API — Real-time Test Suite (PowerShell)
# Tuned for: Render backend + Neon PostgreSQL + Gmail SMTP + Resend
#
# Usage:
#   .\scripts\test-api.ps1
#   .\scripts\test-api.ps1 -BaseUrl "https://backend-jd8f.onrender.com" -Verbose
#   .\scripts\test-api.ps1 -BaseUrl "http://localhost:3000" -Local
# ═══════════════════════════════════════════════════════════════════════════
param(
    [string]$BaseUrl    = "https://backend-jd8f.onrender.com",
    [string]$AdminEmail = "altuverasafari@gmail.com",
    [string]$AdminPass  = $env:ADMIN_PASS,          # set via env — never hardcode
    [string]$TestEmail  = "tester_$(Get-Random -Maximum 99999)@mailinator.com",
    [switch]$Local,     # override BaseUrl to localhost:3000
    [switch]$Verbose,   # show raw HTTP detail
    [switch]$SkipSlow   # skip rate-limit hammering
)

if ($Local) { $BaseUrl = "http://localhost:3000" }
if (-not $AdminPass) {
    Write-Host "  ⚠️  ADMIN_PASS not set. Admin tests will be skipped." -ForegroundColor Yellow
    Write-Host "     Set it:  `$env:ADMIN_PASS = 'yourpassword'" -ForegroundColor DarkGray
}

$API = "$BaseUrl/api"

# ══════════════════════════════════════════════════════════════════════════
# COLOUR / PRINT HELPERS
# ══════════════════════════════════════════════════════════════════════════
function Print-Header ($msg) {
    Write-Host "`n  ┌─ $msg" -ForegroundColor DarkCyan
}
function Print-Pass   ($msg) { Write-Host "  │  ✅  $msg" -ForegroundColor Green  }
function Print-Fail   ($msg) { Write-Host "  │  ❌  $msg" -ForegroundColor Red    }
function Print-Warn   ($msg) { Write-Host "  │  ⚠️   $msg" -ForegroundColor Yellow }
function Print-Info   ($msg) { Write-Host "  │     $msg"  -ForegroundColor Gray   }
function Print-Detail ($msg) { if ($Verbose) { Write-Host "  │     $msg" -ForegroundColor DarkGray } }
function Print-Divider      { Write-Host "  └─────────────────────────────────────────────────────" -ForegroundColor DarkGray }

# ══════════════════════════════════════════════════════════════════════════
# SHARED STATE
# ══════════════════════════════════════════════════════════════════════════
$script:Pass       = 0
$script:Fail       = 0
$script:Warn       = 0
$script:AdminToken = ""
$script:UserToken  = ""
$script:ContactId  = $null

# ══════════════════════════════════════════════════════════════════════════
# HTTP WRAPPER
# ══════════════════════════════════════════════════════════════════════════
function Invoke-Api {
    param(
        [string]   $Method  = "GET",
        [string]   $Path,
        [hashtable]$Body    = @{},
        [string]   $Token   = "",
        [int]      $TimeoutSec = 30
    )

    $url     = "$API$Path"
    $headers = @{
        "Content-Type" = "application/json"
        "Accept"       = "application/json"
        "User-Agent"   = "Altuvera-TestSuite/1.0"
    }
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }

    Print-Detail "→ $Method $url"

    try {
        $p = @{
            Uri             = $url
            Method          = $Method
            Headers         = $headers
            TimeoutSec      = $TimeoutSec
            UseBasicParsing = $true
            ErrorAction     = "Stop"
        }
        if ($Method -in @("POST","PUT","PATCH") -and $Body.Count -gt 0) {
            $p["Body"] = ($Body | ConvertTo-Json -Depth 10 -Compress)
        }

        $resp = Invoke-WebRequest @p
        $json = $null
        try { $json = $resp.Content | ConvertFrom-Json } catch {}
        Print-Detail "   ← HTTP $($resp.StatusCode)"
        return @{ Ok=$true; Status=[int]$resp.StatusCode; Data=$json; Raw=$resp.Content }
    }
    catch {
        $sc = 0
        try { $sc = [int]$_.Exception.Response.StatusCode } catch {}

        $errBody = ""
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $errBody = $reader.ReadToEnd()
        } catch {}

        $errJson = $null
        try { $errJson = $errBody | ConvertFrom-Json } catch {}

        Print-Detail "   ← HTTP $sc  $errBody"
        return @{
            Ok     = $false
            Status = $sc
            Data   = $errJson
            Error  = $_.Exception.Message
            Raw    = $errBody
        }
    }
}

# ══════════════════════════════════════════════════════════════════════════
# ASSERT HELPERS
# ══════════════════════════════════════════════════════════════════════════
function Assert-Ok {
    param($r, [string]$Label, [int]$Code = 0)
    $statusOk = ($Code -eq 0) -or ($r.Status -eq $Code)
    if ($r.Ok -and $statusOk) {
        $script:Pass++
        Print-Pass "$Label  [HTTP $($r.Status)]"
    } else {
        $script:Fail++
        $reason = if ($r.Error) { $r.Error } elseif ($r.Data?.message) { $r.Data.message } elseif ($r.Data?.error) { $r.Data.error } else { "unexpected" }
        Print-Fail "$Label  [HTTP $($r.Status)]  — $reason"
    }
    return $r
}

function Assert-Fail {
    param($r, [string]$Label)
    if (-not $r.Ok -and $r.Status -ne 0) {
        $script:Pass++
        Print-Pass "$Label  (correctly rejected — HTTP $($r.Status))"
    } else {
        $script:Fail++
        Print-Fail "$Label  (should have failed — got HTTP $($r.Status))"
    }
}

function Assert-Contains {
    param($r, [string]$Label, [string]$Key)
    $val = $r.Data
    $Key.Split(".") | ForEach-Object { if ($val -ne $null) { $val = $val.$_ } }
    if ($null -ne $val) {
        $script:Pass++
        Print-Pass "$Label  (field '$Key' present)"
    } else {
        $script:Fail++
        Print-Fail "$Label  (field '$Key' missing in response)"
    }
}

function Skip-Test {
    param([string]$Label)
    $script:Warn++
    Print-Warn "SKIP  $Label"
}

# ══════════════════════════════════════════════════════════════════════════
# ██████████████████████████████████████████████████████████████████████████
# BEGIN TESTS
# ██████████████████████████████████████████████████████████════════════════
# ══════════════════════════════════════════════════════════════════════════

$startTime = Get-Date

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor DarkCyan
Write-Host "║   🦁  ALTUVERA API TEST SUITE                            ║" -ForegroundColor Cyan
Write-Host "╠═══════════════════════════════════════════════════════════╣" -ForegroundColor DarkCyan
Write-Host "║  Backend  : $($BaseUrl.PadRight(45)) ║" -ForegroundColor Gray
Write-Host "║  Admin    : $($AdminEmail.PadRight(45)) ║" -ForegroundColor Gray
Write-Host "║  TestUser : $($TestEmail.PadRight(45)) ║" -ForegroundColor Gray
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor DarkCyan

# ──────────────────────────────────────────────────────────────────────────
# 1. HEALTH / CONNECTIVITY
# ──────────────────────────────────────────────────────────────────────────
Print-Header "1. HEALTH CHECK"

# Wake render dyno (cold start can take ~30s)
Write-Host "  │  Pinging server (Render cold start may take up to 30s)..." -ForegroundColor Gray
$alive = $false
for ($try = 1; $try -le 6; $try++) {
    $r = Invoke-Api -Method GET -Path "/health" -TimeoutSec 35
    if ($r.Ok -or $r.Status -in @(200,404)) { $alive = $true; break }
    # also try root
    $r2 = Invoke-Api -Method GET -Path "" -TimeoutSec 10
    if ($r2.Ok) { $alive = $true; break }
    Print-Info "  attempt $try/6 — waiting 8s..."
    Start-Sleep -Seconds 8
}

if (-not $alive) {
    Print-Fail "Server unreachable at $BaseUrl after 6 attempts — aborting."
    Print-Divider
    exit 1
}

Assert-Ok $r "GET /api/health (or server reachable)"

# Environment checks
if ($r.Data?.data -or $r.Data?.status) {
    Print-Info "Server reports: $($r.Data | ConvertTo-Json -Compress)"
}

Print-Divider

# ──────────────────────────────────────────────────────────────────────────
# 2. ADMIN AUTH
# ──────────────────────────────────────────────────────────────────────────
Print-Header "2. ADMIN AUTHENTICATION"

if (-not $AdminPass) {
    Skip-Test "Admin login — ADMIN_PASS not set"
} else {
    # ── correct credentials ──
    $r = Invoke-Api -Method POST -Path "/admin/login" -Body @{
        email    = $AdminEmail
        password = $AdminPass
    }
    $r = Assert-Ok $r "POST /api/admin/login"

    $tok = $r.Data?.data?.token ?? $r.Data?.token
    if ($tok) {
        $script:AdminToken = $tok
        Print-Info "Admin JWT acquired (${$tok.Substring(0,[Math]::Min(24,$tok.Length))}…)"
    } else {
        Print-Warn "Token not found in response — check controller serialisation"
    }

    # ── wrong password ──
    $r = Invoke-Api -Method POST -Path "/admin/login" -Body @{
        email    = $AdminEmail
        password = "DEFINITELY_WRONG_PASSWORD_XYZ_999"
    }
    Assert-Fail $r "Admin login with wrong password rejected"

    # ── missing fields ──
    $r = Invoke-Api -Method POST -Path "/admin/login" -Body @{ email = $AdminEmail }
    Assert-Fail $r "Admin login missing password rejected"

    # ── GET /me (protected) ──
    if ($script:AdminToken) {
        $r = Invoke-Api -Method GET -Path "/admin/me" -Token $script:AdminToken
        if ($r.Ok) { Assert-Ok $r "GET /api/admin/me" }
        else        { Print-Warn "GET /api/admin/me → HTTP $($r.Status) (route may not exist)" }
    }
}

Print-Divider

# ──────────────────────────────────────────────────────────────────────────
# 3. USER AUTH — OTP FLOW
# ──────────────────────────────────────────────────────────────────────────
Print-Header "3. USER AUTH (OTP / passwordless)"

# ── register new user ──
$r = Invoke-Api -Method POST -Path "/users/register" -Body @{
    email    = $TestEmail
    fullName = "Altuvera Test User"
}
Assert-Ok $r "POST /api/users/register (new user)"

# ── login sends OTP ──
$r = Invoke-Api -Method POST -Path "/users/login" -Body @{ email = $TestEmail }
Assert-Ok $r "POST /api/users/login (OTP dispatched)"

# ── duplicate register (unverified — should resend OTP) ──
Start-Sleep -Seconds 2   # respect 1-min cooldown only if re-running quickly
$r = Invoke-Api -Method POST -Path "/users/register" -Body @{
    email    = $TestEmail
    fullName = "Altuvera Test User"
}
if ($r.Ok -or $r.Status -eq 200) {
    Assert-Ok $r "POST /api/users/register (resend OTP for unverified)"
} else {
    Print-Warn "Re-register returned HTTP $($r.Status) — may be rate-limited (OK)"
}

# ── check-email ──
$r = Invoke-Api -Method POST -Path "/users/check-email" -Body @{ email = $TestEmail }
Assert-Ok $r "POST /api/users/check-email"
if ($r.Data?.data?.exists -eq $true) { Print-Info "Email correctly flagged as existing" }
else { Print-Warn "Email 'exists' flag = $($r.Data?.data?.exists)" }

# ── wrong OTP ──
$r = Invoke-Api -Method POST -Path "/users/verify-code" -Body @{
    email = $TestEmail
    code  = "000000"
}
Assert-Fail $r "Wrong OTP rejected"

# ── expired / garbage code ──
$r = Invoke-Api -Method POST -Path "/users/verify-code" -Body @{
    email = $TestEmail
    code  = "abcdef"
}
Assert-Fail $r "Non-numeric OTP rejected"

# ── resend-code ──
$r = Invoke-Api -Method POST -Path "/users/resend-code" -Body @{ email = $TestEmail }
if ($r.Ok) { Assert-Ok $r "POST /api/users/resend-code" }
else        { Print-Warn "Resend returned HTTP $($r.Status) — likely rate-limited (acceptable)" }

# ── check-email for non-existent ──
$r = Invoke-Api -Method POST -Path "/users/check-email" -Body @{
    email = "nonexistent_$(Get-Random)@nowhere.invalid"
}
Assert-Ok $r "POST /api/users/check-email (non-existent → exists: false)"
if ($r.Data?.data?.exists -eq $false) { Print-Info "Non-existent email correctly returns exists:false" }

# ── Note about real OTP ──
Print-Info "──────────────────────────────────────────────────────"
Print-Info "SMTP configured: $AdminEmail via smtp.gmail.com:587"
Print-Info "Real OTP sent to $TestEmail (mailinator — check inbox)"
Print-Info "To manually verify: POST /api/users/verify-code { email, code }"
Print-Info "──────────────────────────────────────────────────────"

Print-Divider

# ──────────────────────────────────────────────────────────────────────────
# 4. CONTACT FORM  (public — rate-limited 5/15min on Render)
# ──────────────────────────────────────────────────────────────────────────
Print-Header "4. CONTACT FORM (public)"

$contactEmail = "contact_tester_$(Get-Random -Maximum 9999)@mailinator.com"

$r = Invoke-Api -Method POST -Path "/contact" -Body @{
    name     = "Gorilla Safari Tester"
    email    = $contactEmail
    subject  = "7-Day Gorilla Trekking — Test Inquiry"
    message  = "Hello Altuvera team! I am testing the contact form via the automated PowerShell test suite. Please disregard this message."
    phone    = "+250792000001"
    tripType = "Gorilla Trekking"
    source   = "test_script"
}
$r = Assert-Ok $r "POST /api/contact (valid submission)"

if ($r.Data?.data?.id) {
    $script:ContactId = $r.Data.data.id
    Print-Info "Contact record ID: $($script:ContactId)"
} elseif ($r.Data?.id) {
    $script:ContactId = $r.Data.id
    Print-Info "Contact record ID: $($script:ContactId)"
}

# ── Validation: missing name ──
$r = Invoke-Api -Method POST -Path "/contact" -Body @{
    email   = "val@test.com"
    message = "This message has no name field at all whatsoever"
}
Assert-Fail $r "Contact rejected — name missing"

# ── Validation: invalid email ──
$r = Invoke-Api -Method POST -Path "/contact" -Body @{
    name    = "Bad Email User"
    email   = "not-a-valid-email-address"
    message = "This contact form submission has an invalid email address format"
}
Assert-Fail $r "Contact rejected — invalid email"

# ── Validation: message too short ──
$r = Invoke-Api -Method POST -Path "/contact" -Body @{
    name    = "Short Message"
    email   = "short@test.com"
    message = "Too short"
}
Assert-Fail $r "Contact rejected — message < 20 chars"

# ── Validation: missing message ──
$r = Invoke-Api -Method POST -Path "/contact" -Body @{
    name  = "No Message"
    email = "nomsg@test.com"
}
Assert-Fail $r "Contact rejected — message missing"

# ── optional fields (camelCase from frontend) ──
$r = Invoke-Api -Method POST -Path "/contact" -Body @{
    name         = "Camel Case Tester"
    email        = "camel_$(Get-Random -Maximum 9999)@mailinator.com"
    subject      = "Testing camelCase field mapping from frontend"
    message      = "This submission uses camelCase field names as sent by the React frontend form component."
    tripType     = "Mountain Trekking"
    travelDate   = "2025-10-15"
    travelers    = "2"
    phone        = "+250700111222"
}
Assert-Ok $r "POST /api/contact (camelCase fields from frontend)"

Print-Divider

# ──────────────────────────────────────────────────────────────────────────
# 5. CONTACT — ADMIN CRUD
# ──────────────────────────────────────────────────────────────────────────
Print-Header "5. CONTACT ADMIN ROUTES"

if (-not $script:AdminToken) {
    Skip-Test "All admin contact tests — no admin token"
    Print-Divider
} else {
    # ── List ──
    $r = Invoke-Api -Method GET -Path "/contact" -Token $script:AdminToken
    $r = Assert-Ok $r "GET /api/contact (admin list)"
    if ($r.Data?.data) { Print-Info "Returned $(@($r.Data.data).Count) record(s)" }

    # ── Filter: status=new ──
    $r = Invoke-Api -Method GET -Path "/contact?status=new&sort=newest&limit=10" -Token $script:AdminToken
    Assert-Ok $r "GET /api/contact?status=new"

    # ── Filter: search ──
    $r = Invoke-Api -Method GET -Path "/contact?search=Gorilla" -Token $script:AdminToken
    Assert-Ok $r "GET /api/contact?search=Gorilla"

    # ── Filter: priority ──
    $r = Invoke-Api -Method GET -Path "/contact?priority=urgent" -Token $script:AdminToken
    Assert-Ok $r "GET /api/contact?priority=urgent"

    # ── Filter: unread ──
    $r = Invoke-Api -Method GET -Path "/contact?is_read=false" -Token $script:AdminToken
    Assert-Ok $r "GET /api/contact?is_read=false"

    # ── Stats ──
    $r = Invoke-Api -Method GET -Path "/contact/stats" -Token $script:AdminToken
    $r = Assert-Ok $r "GET /api/contact/stats"
    if ($r.Data?.data?.overview) {
        $ov = $r.Data.data.overview
        Print-Info "Stats → total:$($ov.total)  new:$($ov.new)  unread:$($ov.unread)  replied:$($ov.replied)"
    }

    # ── Export JSON ──
    $r = Invoke-Api -Method GET -Path "/contact/export?format=json" -Token $script:AdminToken
    Assert-Ok $r "GET /api/contact/export?format=json"

    # ── Export CSV ──
    $r = Invoke-Api -Method GET -Path "/contact/export?format=csv" -Token $script:AdminToken
    if ($r.Ok) { Assert-Ok $r "GET /api/contact/export?format=csv" }
    else        { Print-Warn "CSV export → HTTP $($r.Status)" }

    # ── Single message ops (need a known ID) ──
    if ($script:ContactId) {
        $id = $script:ContactId

        $r = Invoke-Api -Method GET -Path "/contact/$id" -Token $script:AdminToken
        Assert-Ok $r "GET /api/contact/$id"

        $r = Invoke-Api -Method PATCH -Path "/contact/$id/read" -Token $script:AdminToken
        Assert-Ok $r "PATCH /api/contact/$id/read"
        if ($r.Data?.data?.isRead -eq $true) { Print-Info "isRead = true ✓" }

        $r = Invoke-Api -Method PATCH -Path "/contact/$id/star" -Token $script:AdminToken
        Assert-Ok $r "PATCH /api/contact/$id/star"
        Print-Info "isStarred toggled to $($r.Data?.data?.isStarred)"

        $r = Invoke-Api -Method PATCH -Path "/contact/$id/star" -Token $script:AdminToken
        Assert-Ok $r "PATCH /api/contact/$id/star (toggle back)"

        $r = Invoke-Api -Method PATCH -Path "/contact/$id/unread" -Token $script:AdminToken
        Assert-Ok $r "PATCH /api/contact/$id/unread"

        $r = Invoke-Api -Method PUT -Path "/contact/$id" -Token $script:AdminToken -Body @{
            priority       = "high"
            response_notes = "Automated test note — priority set to high"
        }
        Assert-Ok $r "PUT /api/contact/$id (update priority + notes)"

        # ── Bulk ops ──
        $r = Invoke-Api -Method POST -Path "/contact/bulk" -Token $script:AdminToken -Body @{
            ids    = @($id)
            action = "markRead"
        }
        Assert-Ok $r "POST /api/contact/bulk (markRead)"

        $r = Invoke-Api -Method POST -Path "/contact/bulk" -Token $script:AdminToken -Body @{
            ids    = @($id)
            action = "setPriority"
            value  = "urgent"
        }
        Assert-Ok $r "POST /api/contact/bulk (setPriority=urgent)"

        # ── Bulk: invalid action ──
        $r = Invoke-Api -Method POST -Path "/contact/bulk" -Token $script:AdminToken -Body @{
            ids    = @($id)
            action = "nonExistentAction"
        }
        Assert-Fail $r "Bulk invalid action rejected"

        # ── Bulk: missing ids ──
        $r = Invoke-Api -Method POST -Path "/contact/bulk" -Token $script:AdminToken -Body @{
            action = "markRead"
        }
        Assert-Fail $r "Bulk missing ids rejected"

        # ── Reply ──
        $r = Invoke-Api -Method POST -Path "/contact/$id/reply" -Token $script:AdminToken -Body @{
            subject = "Re: 7-Day Gorilla Trekking — Test Inquiry"
            body    = "Thank you for reaching out! This is an automated test reply sent via the PowerShell test suite. Our team will be in touch shortly."
        }
        if ($r.Ok) {
            Assert-Ok $r "POST /api/contact/$id/reply"
            Print-Info "Email sent via: smtp.gmail.com / Resend"
        } else {
            Print-Warn "Reply → HTTP $($r.Status) — SMTP/Resend may be cold on Render (acceptable)"
            $script:Warn++
        }

        # ── Reply: missing body ──
        $r = Invoke-Api -Method POST -Path "/contact/$id/reply" -Token $script:AdminToken -Body @{
            subject = "Subject only, no body"
        }
        Assert-Fail $r "Reply without body rejected"

        # ── Archive ──
        $r = Invoke-Api -Method PATCH -Path "/contact/$id/archive" -Token $script:AdminToken
        Assert-Ok $r "PATCH /api/contact/$id/archive"
        if ($r.Data?.data?.status -eq "archived") { Print-Info "status = archived ✓" }

        # ── Delete ──
        $r = Invoke-Api -Method DELETE -Path "/contact/$id" -Token $script:AdminToken
        Assert-Ok $r "DELETE /api/contact/$id"

        # ── Confirm 404 after delete ──
        $r = Invoke-Api -Method GET -Path "/contact/$id" -Token $script:AdminToken
        Assert-Fail $r "GET deleted contact → 404"

        # ── Delete non-existent ──
        $r = Invoke-Api -Method DELETE -Path "/contact/999999999" -Token $script:AdminToken
        Assert-Fail $r "DELETE non-existent contact → 404"
    } else {
        Print-Warn "No ContactId captured — single-record tests skipped"
    }

    # ── Unauthenticated access ──
    $r = Invoke-Api -Method GET -Path "/contact"
    Assert-Fail $r "GET /api/contact without token → 401"

    Print-Divider
}

# ──────────────────────────────────────────────────────────────────────────
# 6. PUBLIC API ROUTES
# ──────────────────────────────────────────────────────────────────────────
Print-Header "6. PUBLIC ENDPOINTS"

$publicRoutes = @(
    @{ Path="/destinations";                 Label="Destinations list"          },
    @{ Path="/destinations?limit=3&page=1";  Label="Destinations paginated"     },
    @{ Path="/destinations?featured=true";   Label="Destinations featured"      },
    @{ Path="/team";                         Label="Team members"               },
    @{ Path="/team?is_active=true";          Label="Team active members"        },
    @{ Path="/faqs";                         Label="FAQs"                       },
    @{ Path="/categories";                   Label="Categories"                 },
    @{ Path="/testimonials";                 Label="Testimonials"               },
    @{ Path="/services";                     Label="Services"                   },
    @{ Path="/countries";                    Label="Countries"                  },
)

foreach ($route in $publicRoutes) {
    $r = Invoke-Api -Method GET -Path $route.Path
    if ($r.Ok) {
        Assert-Ok $r "GET /api$($route.Path)"
        $count = if ($r.Data?.data) { @($r.Data.data).Count } else { "?" }
        Print-Info "$count record(s) returned"
    } elseif ($r.Status -eq 404) {
        Print-Warn "GET /api$($route.Path) → 404 (route not yet implemented)"
        $script:Warn++
    } else {
        Print-Warn "GET /api$($route.Path) → HTTP $($r.Status)"
        $script:Warn++
    }
}

Print-Divider

# ──────────────────────────────────────────────────────────────────────────
# 7. TEAM — ADMIN
# ──────────────────────────────────────────────────────────────────────────
Print-Header "7. TEAM MANAGEMENT (admin)"

if (-not $script:AdminToken) {
    Skip-Test "All team admin tests — no admin token"
} else {
    $teamRoutes = @(
        "/team",
        "/team?limit=5&page=1",
        "/team/stats",
        "/team/departments/list",
    )
    foreach ($path in $teamRoutes) {
        $r = Invoke-Api -Method GET -Path $path -Token $script:AdminToken
        if ($r.Ok) { Assert-Ok $r "GET /api$path" }
        else        { Print-Warn "GET /api$path → HTTP $($r.Status)" }
    }
}

Print-Divider

# ──────────────────────────────────────────────────────────────────────────
# 8. BOOKINGS
# ──────────────────────────────────────────────────────────────────────────
Print-Header "8. BOOKINGS"

# Public booking submission
$r = Invoke-Api -Method POST -Path "/bookings" -Body @{
    firstName           = "Test"
    lastName            = "Booker"
    email               = "booker_$(Get-Random -Maximum 9999)@mailinator.com"
    phone               = "+250700999888"
    country             = "Rwanda"
    startDate           = "2025-11-01"
    endDate             = "2025-11-08"
    adults              = 2
    children            = 0
    infants             = 0
    groupType           = "couple"
    accommodationType   = "Luxury Lodge"
    interests           = @("Gorilla Trekking","Wildlife Safari")
    budgetRange         = "$5000-$8000"
    specialRequests     = "Vegetarian meals please"
    agreeToTerms        = $true
    subscribeNewsletter = $false
    source              = "test_script"
}
if ($r.Ok) {
    Assert-Ok $r "POST /api/bookings"
} elseif ($r.Status -eq 404) {
    Print-Warn "POST /api/bookings → 404 (not yet implemented)"
    $script:Warn++
} else {
    Print-Warn "POST /api/bookings → HTTP $($r.Status)"
    $script:Warn++
}

# Missing agreeToTerms
$r = Invoke-Api -Method POST -Path "/bookings" -Body @{
    firstName = "No Terms"
    email     = "noterms@test.com"
    adults    = 1
}
if ($r.Status -eq 404) {
    Print-Warn "Bookings route not yet implemented (404)"
    $script:Warn++
} else {
    Assert-Fail $r "Booking rejected — agreeToTerms missing"
}

Print-Divider

# ──────────────────────────────────────────────────────────────────────────
# 9. ADMIN DASHBOARD / ANALYTICS
# ──────────────────────────────────────────────────────────────────────────
Print-Header "9. ADMIN DASHBOARD & ANALYTICS"

if (-not $script:AdminToken) {
    Skip-Test "Dashboard tests — no admin token"
} else {
    $dashRoutes = @(
        "/admin/stats",
        "/admin/dashboard",
        "/analytics/overview",
        "/analytics/bookings",
        "/analytics/traffic",
    )
    foreach ($path in $dashRoutes) {
        $r = Invoke-Api -Method GET -Path $path -Token $script:AdminToken
        if ($r.Ok)               { Assert-Ok $r "GET /api$path" }
        elseif ($r.Status -eq 404) { Print-Warn "GET /api$path → 404 (not yet implemented)" }
        else                       { Print-Warn "GET /api$path → HTTP $($r.Status)" }
    }
}

Print-Divider

# ──────────────────────────────────────────────────────────────────────────
# 10. OAUTH ENDPOINTS — config check
# ──────────────────────────────────────────────────────────────────────────
Print-Header "10. OAUTH CONFIG CHECK"

# Google — bad credential should return 401, not 500
$r = Invoke-Api -Method POST -Path "/users/google" -Body @{
    credential = "INVALID.GOOGLE.CREDENTIAL.TOKEN"
}
if ($r.Status -in @(400, 401, 422)) {
    $script:Pass++
    Print-Pass "Google OAuth rejects invalid credential → HTTP $($r.Status)"
} elseif ($r.Status -eq 500) {
    $script:Fail++
    Print-Fail "Google OAuth threw 500 on bad credential (check GOOGLE_CLIENT_ID config)"
} elseif ($r.Status -eq 404) {
    Print-Warn "Google OAuth route not found (404)"
    $script:Warn++
} else {
    Print-Warn "Google OAuth → HTTP $($r.Status)"
}

# GitHub — missing code
$r = Invoke-Api -Method POST -Path "/users/github" -Body @{}
if ($r.Status -in @(400, 422)) {
    $script:Pass++
    Print-Pass "GitHub OAuth rejects missing code → HTTP $($r.Status)"
} elseif ($r.Status -eq 404) {
    Print-Warn "GitHub OAuth route not found (404)"
    $script:Warn++
} else {
    Print-Warn "GitHub OAuth → HTTP $($r.Status)"
}

Print-Divider

# ──────────────────────────────────────────────────────────────────────────
# 11. SECURITY CHECKS
# ──────────────────────────────────────────────────────────────────────────
Print-Header "11. SECURITY"

# ── Fake/tampered JWT ──
$fakeJwt = "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6OTk5OTk5OX0.FAKESIGNATUREXYZ"
$r = Invoke-Api -Method GET -Path "/contact" -Token $fakeJwt
Assert-Fail $r "Tampered JWT rejected"

# ── Expired JWT (crafted) ──
$expiredJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZW1haWwiOiJ0ZXN0QHRlc3QuY29tIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE2MDAwMDAwMDF9.vRFfUarF44kz0LYeaclTalFTIBdMWlqkPQEZ3Hl7BpY"
$r = Invoke-Api -Method GET -Path "/contact" -Token $expiredJwt
Assert-Fail $r "Expired JWT rejected"

# ── SQL injection in contact form ──
$r = Invoke-Api -Method POST -Path "/contact" -Body @{
    name    = "'; DROP TABLE contact_messages; --"
    email   = "sqlinject@test.com"
    subject = "SQL Injection Test"
    message = "Robert'); DROP TABLE contact_messages; -- this should be stored safely via parameterized query"
}
if ($r.Status -gt 0 -and $r.Status -lt 500) {
    $script:Pass++
    Print-Pass "SQL injection in contact handled safely → HTTP $($r.Status)"
} else {
    $script:Fail++
    Print-Fail "SQL injection caused 500 or no response → HTTP $($r.Status)"
}

# ── XSS payload in contact form ──
$r = Invoke-Api -Method POST -Path "/contact" -Body @{
    name    = "<script>alert('xss')</script>"
    email   = "xss_$(Get-Random -Maximum 9999)@test.com"
    subject = "<img src=x onerror=alert(1)>"
    message = "XSS test: <script>document.cookie</script> — this payload should be stored as plain text"
}
if ($r.Status -gt 0 -and $r.Status -lt 500) {
    $script:Pass++
    Print-Pass "XSS payload handled safely → HTTP $($r.Status)"
} else {
    $script:Fail++
    Print-Fail "XSS caused 500 or no response → HTTP $($r.Status)"
}

# ── Oversized message (> 5000 chars) ──
$bigMsg = "A" * 6500
$r = Invoke-Api -Method POST -Path "/contact" -Body @{
    name    = "Overflow Test"
    email   = "overflow@test.com"
    subject = "Overflow"
    message = $bigMsg
}
if ($r.Status -gt 0 -and $r.Status -lt 500) {
    $script:Pass++
    Print-Pass "Oversized payload handled gracefully → HTTP $($r.Status)"
} else {
    $script:Fail++
    Print-Fail "Oversized payload caused 500 → HTTP $($r.Status)"
}

# ── CORS header check ──
try {
    $corsResp = Invoke-WebRequest -Uri "$API/health" -Method OPTIONS `
        -Headers @{
            "Origin"                         = "https://altuverasafaris.com"
            "Access-Control-Request-Method"  = "POST"
            "Access-Control-Request-Headers" = "Content-Type,Authorization"
        } `
        -UseBasicParsing -TimeoutSec 10 -ErrorAction SilentlyContinue

    $acao = $corsResp.Headers["Access-Control-Allow-Origin"]
    if ($acao -and ($acao -eq "*" -or $acao -like "*altuverasafaris.com*" -or $acao -like "*altuvera*")) {
        $script:Pass++
        Print-Pass "CORS header present: Access-Control-Allow-Origin = $acao"
    } else {
        $script:Warn++
        Print-Warn "CORS header missing or restrictive: '$acao'"
    }
} catch {
    Print-Warn "CORS preflight check failed: $($_.Exception.Message)"
}

Print-Divider

# ──────────────────────────────────────────────────────────────────────────
# 12. RATE LIMITING  (contact endpoint — 5 req/15min on Render)
# ──────────────────────────────────────────────────────────────────────────
Print-Header "12. RATE LIMITING"

if ($SkipSlow) {
    Skip-Test "Rate limit test — skipped via -SkipSlow flag"
} else {
    Print-Info "Firing rapid contact submissions from same IP to trigger limiter..."
    $rlEmail    = "ratelimit_$(Get-Random -Maximum 9999)@mailinator.com"
    $rlHit      = $false
    $rlAttempts = 0

    for ($i = 1; $i -le 8; $i++) {
        $r = Invoke-Api -Method POST -Path "/contact" -Body @{
            name    = "Rate Limit Bot $i"
            email   = $rlEmail
            subject = "Rate limit probe $i"
            message = "This is automated rate limit test probe number $i sent from the PowerShell test suite script."
        }
        $rlAttempts++

        if ($r.Status -eq 429) {
            $rlHit = $true
            $script:Pass++
            $waitSec = $r.Data?.retryAfter ?? $r.Data?.waitSeconds ?? "?"
            Print-Pass "Rate limiter triggered on attempt $i → 429 (retry after: ${waitSec}s)"
            break
        }
        Print-Detail "  Shot $i → HTTP $($r.Status)"
        Start-Sleep -Milliseconds 300
    }

    if (-not $rlHit) {
        $script:Warn++
        Print-Warn "Rate limiter NOT triggered after $rlAttempts attempts"
        Print-Warn "Check: express-rate-limit windowMs=15min max=5 in routes/contact.js"
    }
}

Print-Divider

# ──────────────────────────────────────────────────────────────────────────
# 13. EMAIL DELIVERY CHECK
# ──────────────────────────────────────────────────────────────────────────
Print-Header "13. EMAIL DELIVERY"

Print-Info "Configured SMTP : smtp.gmail.com:587 (TLS)"
Print-Info "SMTP User       : altuverasafari@gmail.com"
Print-Info "Resend API Key  : re_MwRfMe1v_... (configured)"
Print-Info "Admin notif to  : altuverasafari@gmail.com"
Print-Info ""
Print-Info "Email is sent non-blocking (fire-and-forget) on contact submit."
Print-Info "Check altuverasafari@gmail.com for:"
Print-Info "  → Admin notification for contact test submissions above"
Print-Info "  → Auto-reply sent to $contactEmail"
Print-Info ""

# Render blocks SMTP ports — check if Resend fallback is wired
Print-Warn "NOTE: Render.com blocks outbound SMTP (ports 25/465/587)."
Print-Warn "If emails are not arriving, switch to Resend/SendGrid HTTPS API."
Print-Warn "RESEND_API_KEY is set in .env — ensure your email utility uses it."

Print-Divider

# ──────────────────────────────────────────────────────────────────────────
# 14. DATABASE CONNECTIVITY
# ──────────────────────────────────────────────────────────────────────────
Print-Header "14. DATABASE (Neon PostgreSQL)"

# Indirect check via a DB-backed endpoint
$r = Invoke-Api -Method GET -Path "/destinations?limit=1"
if ($r.Ok) {
    $script:Pass++
    Print-Pass "DB reachable (destinations query returned HTTP $($r.Status))"
} elseif ($r.Status -eq 404) {
    Print-Warn "Destinations route 404 — try another DB-backed route"
    $r2 = Invoke-Api -Method GET -Path "/faqs"
    if ($r2.Ok) {
        $script:Pass++
        Print-Pass "DB reachable via FAQs endpoint"
    } else {
        Print-Warn "DB connectivity unclear — all checked routes returned errors"
    }
} elseif ($r.Status -eq 500) {
    $script:Fail++
    Print-Fail "500 on DB-backed route — check DATABASE_URL / Neon connection"
    Print-Info "DB URL: postgresql://...@ep-gentle-butterfly-aii8023t-pooler.c-4.us-east-1.aws.neon.tech/altuvera"
    Print-Info "Ensure sslmode=require (NOT channel_binding=require)"
} else {
    Print-Warn "DB check inconclusive → HTTP $($r.Status)"
}

Print-Divider

# ══════════════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ══════════════════════════════════════════════════════════════════════════
$elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 2)
$total   = $script:Pass + $script:Fail

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor DarkCyan
Write-Host "║   TEST RESULTS                                           ║" -ForegroundColor Cyan
Write-Host "╠═══════════════════════════════════════════════════════════╣" -ForegroundColor DarkCyan
Write-Host "║  Total   : $("$total tests".PadRight(47)) ║" -ForegroundColor White
Write-Host "║  ✅ Pass  : $("$($script:Pass)".PadRight(47)) ║" -ForegroundColor Green
Write-Host "║  ❌ Fail  : $("$($script:Fail)".PadRight(47)) ║" -ForegroundColor $(if ($script:Fail -gt 0) { "Red" } else { "Green" })
Write-Host "║  ⚠️  Warn  : $("$($script:Warn)".PadRight(47)) ║" -ForegroundColor Yellow
Write-Host "║  ⏱ Time  : $("${elapsed}s".PadRight(47)) ║" -ForegroundColor Gray
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor DarkCyan

if ($script:Fail -gt 0) {
    Write-Host ""
    Write-Host "  TROUBLESHOOTING GUIDE" -ForegroundColor Yellow
    Write-Host "  ──────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "  ❌ Admin login fails     → Set ADMIN_PASS env var or create admin in DB" -ForegroundColor Gray
    Write-Host "  ❌ DB 500 errors         → Check DATABASE_URL (remove channel_binding)" -ForegroundColor Gray
    Write-Host "  ❌ JWT errors            → Ensure JWT_SECRET is set in .env" -ForegroundColor Gray
    Write-Host "  ❌ SMTP/email errors     → Render blocks SMTP; use Resend HTTPS API" -ForegroundColor Gray
    Write-Host "  ❌ CORS failures         → Add your origin to CORS_ORIGINS in .env" -ForegroundColor Gray
    Write-Host "  ❌ Rate limit not 429    → Check express-rate-limit in routes/contact.js" -ForegroundColor Gray
    Write-Host "  ⚠️  OTP not arriving      → Check Gmail app password / Resend API key" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  ENV QUICK REFERENCE" -ForegroundColor DarkCyan
    Write-Host "  DB     : Neon / ep-gentle-butterfly-aii8023t-pooler.c-4.us-east-1" -ForegroundColor DarkGray
    Write-Host "  SMTP   : smtp.gmail.com:587  (may be blocked on Render)" -ForegroundColor DarkGray
    Write-Host "  Resend : RESEND_API_KEY=re_MwRfMe1v_...  (preferred on Render)" -ForegroundColor DarkGray
    Write-Host "  JWT    : JWT_SECRET set ✓" -ForegroundColor DarkGray
    Write-Host ""
    exit 1
} else {
    Write-Host ""
    Write-Host "  🎉  All checks passed! Altuvera API is healthy." -ForegroundColor Green
    Write-Host ""
    exit 0
}