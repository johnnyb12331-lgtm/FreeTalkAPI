# Complete API Server Setup on Production

$serverIP = "167.71.97.187"
$sshKey = "~/.ssh/id_ed25519_digitalocean"

Write-Host "🚀 FreeTalk API Server - Complete Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if API directory exists on server
Write-Host "1️⃣  Checking server setup..." -ForegroundColor Yellow
ssh -i $sshKey root@$serverIP "test -d /root/FreeTalkAPI && echo 'EXISTS' || echo 'NOT_FOUND'" 

# Step 2: Upload API files if needed
Write-Host ""
Write-Host "2️⃣  Uploading API files to server..." -ForegroundColor Yellow
Write-Host "Note: Make sure you're in the FreeTalkAPI directory" -ForegroundColor Gray

$confirm = Read-Host "Do you want to upload/update API files? (y/n)"
if ($confirm -eq 'y') {
    # Create directory if it doesn't exist
    ssh -i $sshKey root@$serverIP "mkdir -p /root/FreeTalkAPI"
    
    # Upload files (excluding node_modules and logs)
    Write-Host "Uploading files..." -ForegroundColor Gray
    scp -i $sshKey -r `
        *.js `
        *.json `
        config `
        models `
        routes `
        middleware `
        services `
        scripts `
        setup-api-server.sh `
        root@${serverIP}:/root/FreeTalkAPI/
    
    Write-Host "✅ Files uploaded" -ForegroundColor Green
}

# Step 3: Upload and run setup script
Write-Host ""
Write-Host "3️⃣  Running setup script on server..." -ForegroundColor Yellow
scp -i $sshKey setup-api-server.sh root@${serverIP}:/root/FreeTalkAPI/
ssh -i $sshKey root@$serverIP "cd /root/FreeTalkAPI && chmod +x setup-api-server.sh && bash setup-api-server.sh"

# Step 4: Test the API
Write-Host ""
Write-Host "4️⃣  Testing API endpoints..." -ForegroundColor Yellow
Write-Host ""

Start-Sleep -Seconds 3

# Test health endpoint
try {
    Write-Host "Testing /health endpoint..." -ForegroundColor Gray
    $health = Invoke-RestMethod -Uri "https://freetalk.site/api/health" -Method Get -TimeoutSec 5
    Write-Host "✅ Health check passed!" -ForegroundColor Green
    $health | ConvertTo-Json
} catch {
    Write-Host "⚠️  Health check failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ Setup Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Important Notes:" -ForegroundColor Yellow
Write-Host "   - Make sure .env file is configured on the server" -ForegroundColor Gray
Write-Host "   - Check logs with: ssh root@$serverIP 'pm2 logs freetalk-api'" -ForegroundColor Gray
Write-Host "   - Restart with: ssh root@$serverIP 'pm2 restart freetalk-api'" -ForegroundColor Gray
Write-Host ""
