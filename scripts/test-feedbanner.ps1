# Test Feed Banner Upload from Windows
# Run this from your local machine to test the production server

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "🧪 Testing Feed Banner Upload from Client" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "https://freetalk.site"
$testsPassed = 0
$testsFailed = 0

# Test 1: Check if API is reachable
Write-Host "Test 1: API connectivity..." -NoNewline
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/auth/health" -Method GET -UseBasicParsing -ErrorAction SilentlyContinue
    if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 404) {
        Write-Host " ✅ PASS" -ForegroundColor Green
        $testsPassed++
    } else {
        Write-Host " ❌ FAIL (Status: $($response.StatusCode))" -ForegroundColor Red
        $testsFailed++
    }
} catch {
    Write-Host " ⚠️  WARNING (API endpoint may not exist, but that's okay)" -ForegroundColor Yellow
}

# Test 2: Check if uploads endpoint exists
Write-Host "Test 2: Uploads endpoint..." -NoNewline
try {
    # Try a known file or just check if the endpoint returns something
    $response = Invoke-WebRequest -Uri "$baseUrl/api/uploads/test.jpg" -Method GET -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host " ✅ PASS (File exists)" -ForegroundColor Green
        $testsPassed++
    } else {
        Write-Host " ❌ FAIL (Status: $($response.StatusCode))" -ForegroundColor Red
        $testsFailed++
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 404) {
        Write-Host " ⚠️  File not found (expected, but endpoint is configured)" -ForegroundColor Yellow
        # This is actually okay - it means nginx is proxying correctly
    } elseif ($statusCode -eq 502 -or $statusCode -eq 504) {
        Write-Host " ❌ FAIL (Backend not responding)" -ForegroundColor Red
        $testsFailed++
    } else {
        Write-Host " ⚠️  Status: $statusCode" -ForegroundColor Yellow
    }
}

# Test 3: Test CORS headers
Write-Host "Test 3: CORS headers..." -NoNewline
try {
    $headers = @{
        "Origin" = "https://freetalk.site"
    }
    $response = Invoke-WebRequest -Uri "$baseUrl/api/uploads/test.jpg" -Method GET -Headers $headers -UseBasicParsing -ErrorAction Stop
    $corsHeader = $response.Headers["Access-Control-Allow-Origin"]
    if ($corsHeader) {
        Write-Host " ✅ PASS (CORS enabled)" -ForegroundColor Green
        $testsPassed++
    } else {
        Write-Host " ⚠️  WARNING (No CORS header)" -ForegroundColor Yellow
    }
} catch {
    Write-Host " ⚠️  Could not test (endpoint returned error)" -ForegroundColor Yellow
}

# Test 4: Check specific feed banner file (from your error)
Write-Host "Test 4: Specific feed banner file..." -NoNewline
$feedBannerFile = "feedBanner-1760359633970-497245815.jpg"
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/uploads/$feedBannerFile" -Method GET -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host " ✅ PASS (File exists!)" -ForegroundColor Green
        $testsPassed++
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 404) {
        Write-Host " ❌ FAIL (404 - File not found)" -ForegroundColor Red
        Write-Host "   This is the file causing your error!" -ForegroundColor Red
        Write-Host "   URL: $baseUrl/api/uploads/$feedBannerFile" -ForegroundColor Yellow
        $testsFailed++
    } else {
        Write-Host " ❌ FAIL (Status: $statusCode)" -ForegroundColor Red
        $testsFailed++
    }
}

# Test 5: Check if a sample avatar file exists
Write-Host "Test 5: Sample avatar file..." -NoNewline
$sampleFile = "avatar-1759553633057-296361297.jpg"
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/uploads/$sampleFile" -Method GET -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host " ✅ PASS (Sample file loads)" -ForegroundColor Green
        Write-Host "   This means uploads ARE working for other files!" -ForegroundColor Yellow
        $testsPassed++
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 404) {
        Write-Host " ⚠️  File not found (may not exist)" -ForegroundColor Yellow
    } else {
        Write-Host " ❌ FAIL (Status: $statusCode)" -ForegroundColor Red
        $testsFailed++
    }
}

# Summary
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "📊 Test Summary" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tests Passed: $testsPassed" -ForegroundColor Green
Write-Host "Tests Failed: $testsFailed" -ForegroundColor Red
Write-Host ""

if ($testsFailed -gt 0) {
    Write-Host "⚠️  Issues Detected!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Likely causes:" -ForegroundColor Yellow
    Write-Host "1. The specific feed banner file doesn't exist on the server" -ForegroundColor White
    Write-Host "2. Nginx is not configured to proxy /api/uploads/ correctly" -ForegroundColor White
    Write-Host "3. The Node.js backend is not running" -ForegroundColor White
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. SSH into your server: ssh root@YOUR_SERVER_IP" -ForegroundColor White
    Write-Host "2. Run the diagnostic script:" -ForegroundColor White
    Write-Host "   cd /root/FreeTalkAPI/scripts" -ForegroundColor White
    Write-Host "   chmod +x test-feedbanner.sh" -ForegroundColor White
    Write-Host "   ./test-feedbanner.sh" -ForegroundColor White
    Write-Host "3. Follow the fix guide: /root/FreeTalkAPI/FIX_FEEDBANNER_404.md" -ForegroundColor White
} else {
    Write-Host "🎉 All tests passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "The uploads endpoint is configured correctly." -ForegroundColor Green
    Write-Host "If you're still seeing errors, the specific file may not exist." -ForegroundColor Yellow
    Write-Host "Try uploading a new feed banner image." -ForegroundColor Yellow
}

Write-Host ""
