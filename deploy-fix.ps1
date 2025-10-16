# Deploy validation fix to production server

$serverIP = "167.71.97.187"
$password = "gmpq8w9t0"

Write-Host "🚀 Deploying validation fix to FreeTalk API Server" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

# Check if we can use SSH with password
Write-Host "📡 Connecting to server: $serverIP" -ForegroundColor Yellow
Write-Host ""

# Create a PowerShell script to send commands via SSH
# We'll need to manually paste the password when prompted
Write-Host "You'll be prompted for the password when connecting to SSH." -ForegroundColor Gray
Write-Host "Password: gmpq8w9t0" -ForegroundColor Green
Write-Host ""

# Try to connect and run commands
$commands = @"
cd /root/FreeTalkAPI
echo '📥 Pulling latest changes from GitHub...'
git pull origin main
echo ''
echo '🔄 Restarting API server...'
pm2 restart freetalk-api
echo ''
echo '✅ Deployment complete!'
pm2 status
"@

Write-Host "Connecting to server..." -ForegroundColor Yellow
Write-Host ""

# Use SSH (will prompt for password)
ssh root@$serverIP $commands
