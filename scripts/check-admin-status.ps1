$ErrorActionPreference = "Stop"

$StatusUrl = "https://paid-by-polymarket-os.onrender.com/api/admin/status"
$AdminSecret = [string]$env:PBP_ADMIN_SECRET

if ([string]::IsNullOrWhiteSpace($AdminSecret)) {
    Write-Host "PBP_ADMIN_SECRET is not set in this PowerShell session."
    Write-Host "Set it temporarily with:"
    Write-Host '$env:PBP_ADMIN_SECRET = "paste-your-admin-secret-here"'
    Write-Host "Then run this script again."
    exit 1
}

$Headers = @{
    Authorization = "Bearer $AdminSecret"
}

try {
    $Response = Invoke-RestMethod `
        -Method Get `
        -Uri $StatusUrl `
        -Headers $Headers `
        -ErrorAction Stop

    $SafeSummary = [ordered]@{
        ok = $Response.ok
        storageMode = $Response.storageMode
        waitlist = [ordered]@{
            count = $Response.waitlist.count
            latestSignupAt = $Response.waitlist.latestSignupAt
        }
        checks = [ordered]@{
            waitlistStorage = $Response.checks.waitlistStorage
        }
        generatedAt = $Response.generatedAt
    }

    $SafeSummary | ConvertTo-Json -Depth 4
} catch {
    $StatusCode = $null

    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $StatusCode = [int]$_.Exception.Response.StatusCode
    }

    if ($StatusCode -eq 401) {
        Write-Host "Unauthorized: admin secret is missing or incorrect."
        Write-Host "Check PBP_ADMIN_SECRET in this PowerShell session, then try again."
        exit 1
    }

    if ($StatusCode) {
        Write-Host "Admin status request failed with HTTP status $StatusCode."
        Write-Host "The Render app may be returning a server error. Try again after checking the service health."
        exit 1
    }

    Write-Host "Could not reach the admin status endpoint."
    Write-Host "Check your internet connection and Render service health, then try again."
    Write-Host "Error: $($_.Exception.Message)"
    exit 1
}
