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

    $AlertSignalCount = $null
    $LatestAlertAt = $null
    $AlertStorageCheck = $null
    $OutboundClickCount = $null
    $LatestClickAt = $null
    $OutboundClickStorageCheck = $null
    $FeedbackCount = $null
    $LatestFeedbackAt = $null
    $FeedbackStorageCheck = $null
    $WatchlistInterestCount = $null
    $LatestWatchlistAt = $null
    $WatchlistInterestStorageCheck = $null
    $WatchlistTopMarkets = @()
    $WatchlistTopCategories = @()

    if ($null -ne $Response.alertSignals) {
        $AlertSignalCount = $Response.alertSignals.count
        $LatestAlertAt = $Response.alertSignals.latestAlertAt
    }

    if ($null -ne $Response.outboundClicks) {
        $OutboundClickCount = $Response.outboundClicks.count
        $LatestClickAt = $Response.outboundClicks.latestClickAt
    }

    if ($null -ne $Response.feedback) {
        $FeedbackCount = $Response.feedback.count
        $LatestFeedbackAt = $Response.feedback.latestFeedbackAt
    }

    if ($null -ne $Response.watchlistInterest) {
        $WatchlistInterestCount = $Response.watchlistInterest.count
        $LatestWatchlistAt = $Response.watchlistInterest.latestWatchlistAt
    }

    if ($null -ne $Response.watchlistInsights) {
        if ($null -ne $Response.watchlistInsights.topMarkets) {
            $WatchlistTopMarkets = @($Response.watchlistInsights.topMarkets) | ForEach-Object {
                [ordered]@{
                    marketId = $_.marketId
                    marketQuestion = $_.marketQuestion
                    eventTitle = $_.eventTitle
                    category = $_.category
                    watchCount = $_.watchCount
                    latestWatchlistAt = $_.latestWatchlistAt
                }
            }
        }

        if ($null -ne $Response.watchlistInsights.topCategories) {
            $WatchlistTopCategories = @($Response.watchlistInsights.topCategories) | ForEach-Object {
                [ordered]@{
                    category = $_.category
                    watchCount = $_.watchCount
                }
            }
        }
    }

    if ($null -ne $Response.checks) {
        $AlertStorageCheck = $Response.checks.alertStorage
        $OutboundClickStorageCheck = $Response.checks.outboundClickStorage
        $FeedbackStorageCheck = $Response.checks.feedbackStorage
        $WatchlistInterestStorageCheck = $Response.checks.watchlistInterestStorage
    }

    $SafeSummary = [ordered]@{
        ok = $Response.ok
        storageMode = $Response.storageMode
        waitlist = [ordered]@{
            count = $Response.waitlist.count
            latestSignupAt = $Response.waitlist.latestSignupAt
        }
        alertSignals = [ordered]@{
            count = $AlertSignalCount
            latestAlertAt = $LatestAlertAt
        }
        outboundClicks = [ordered]@{
            count = $OutboundClickCount
            latestClickAt = $LatestClickAt
        }
        feedback = [ordered]@{
            count = $FeedbackCount
            latestFeedbackAt = $LatestFeedbackAt
        }
        watchlistInterest = [ordered]@{
            count = $WatchlistInterestCount
            latestWatchlistAt = $LatestWatchlistAt
        }
        watchlistInsights = [ordered]@{
            topMarkets = $WatchlistTopMarkets
            topCategories = $WatchlistTopCategories
        }
        checks = [ordered]@{
            waitlistStorage = $Response.checks.waitlistStorage
            alertStorage = $AlertStorageCheck
            outboundClickStorage = $OutboundClickStorageCheck
            feedbackStorage = $FeedbackStorageCheck
            watchlistInterestStorage = $WatchlistInterestStorageCheck
        }
        generatedAt = $Response.generatedAt
    }

    $SafeSummary | ConvertTo-Json -Depth 6
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
