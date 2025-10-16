# FreeTalk API - Restart Server Script
# This script helps restart the API server to load new routes

Write-Host "🔄 FreeTalk API Server Restart" -ForegroundColor Cyan
Write-Host ""

$serverUrl = "https://freetalk.site"

Write-Host "📍 Server URL: $serverUrl" -ForegroundColor Yellow
Write-Host ""
Write-Host "The ban/unban routes have been added but the server needs to restart." -ForegroundColor Green
Write-Host ""

Write-Host "Please choose how you want to restart the server:" -ForegroundColor Cyan
Write-Host "1. I have SSH access to the server"
Write-Host "2. I have cPanel/hosting panel access"
Write-Host "3. I need help determining how to restart"
Write-Host ""

$choice = Read-Host "Enter your choice (1-3)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "📝 SSH Restart Instructions:" -ForegroundColor Green
        Write-Host ""
        Write-Host "1. Connect to your server via SSH:" -ForegroundColor Yellow
        Write-Host "   ssh root@your-server-ip" -ForegroundColor White
        Write-Host ""
        Write-Host "2. Navigate to your FreeTalkAPI directory:" -ForegroundColor Yellow
        Write-Host "   cd /var/www/FreeTalkAPI" -ForegroundColor White
        Write-Host "   (or wherever your API is located)" -ForegroundColor Gray
        Write-Host ""
        Write-Host "3. Check if using PM2:" -ForegroundColor Yellow
        Write-Host "   pm2 list" -ForegroundColor White
        Write-Host ""
        Write-Host "4a. If using PM2, restart:" -ForegroundColor Yellow
        Write-Host "   pm2 restart freetalk-api" -ForegroundColor White
        Write-Host "   pm2 logs freetalk-api --lines 50" -ForegroundColor White
        Write-Host ""
        Write-Host "4b. If not using PM2, restart manually:" -ForegroundColor Yellow
        Write-Host "   pkill -f 'node.*server.js'" -ForegroundColor White
        Write-Host "   node server.js &" -ForegroundColor White
        Write-Host ""
        Write-Host "5. Verify the server is running:" -ForegroundColor Yellow
        Write-Host "   curl http://localhost:5000/api/health" -ForegroundColor White
        Write-Host ""
    }
    "2" {
        Write-Host ""
        Write-Host "📝 cPanel/Hosting Panel Instructions:" -ForegroundColor Green
        Write-Host ""
        Write-Host "1. Log into your hosting panel (cPanel, Plesk, etc.)" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "2. Look for 'Node.js Applications' or 'Application Manager'" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "3. Find your FreeTalkAPI application" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "4. Click 'Restart' or 'Stop' then 'Start'" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "5. Check the application logs for any errors" -ForegroundColor Yellow
        Write-Host ""
    }
    "3" {
        Write-Host ""
        Write-Host "📝 General Help:" -ForegroundColor Green
        Write-Host ""
        Write-Host "Your API server (freetalk.site) needs to be restarted to load the new ban/unban routes." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Common server management methods:" -ForegroundColor Cyan
        Write-Host "  • PM2 (Process Manager 2) - Most common for Node.js apps" -ForegroundColor White
        Write-Host "  • systemd - Linux service manager" -ForegroundColor White
        Write-Host "  • cPanel/Hosting Panel - Web hosting control panel" -ForegroundColor White
        Write-Host "  • Docker - Container management" -ForegroundColor White
        Write-Host ""
        Write-Host "To determine which you're using, you need to:" -ForegroundColor Cyan
        Write-Host "1. Access your server (SSH, hosting panel, etc.)" -ForegroundColor White
        Write-Host "2. Check running processes or services" -ForegroundColor White
        Write-Host "3. Restart the Node.js application" -ForegroundColor White
        Write-Host ""
        Write-Host "If you're not sure how your server is hosted, contact your:" -ForegroundColor Yellow
        Write-Host "  • Hosting provider support" -ForegroundColor White
        Write-Host "  • System administrator" -ForegroundColor White
        Write-Host "  • Developer who set up the server" -ForegroundColor White
        Write-Host ""
    }
    default {
        Write-Host "Invalid choice. Please run the script again." -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "📋 What changed:" -ForegroundColor Cyan
Write-Host "  • Added ban user endpoint: PUT /api/admin/users/:userId/ban" -ForegroundColor Green
Write-Host "  • Added unban user endpoint: PUT /api/admin/users/:userId/unban" -ForegroundColor Green
Write-Host "  • Improved error logging in admin panel" -ForegroundColor Green
Write-Host ""
Write-Host "After restarting the server, test the ban functionality in the admin panel." -ForegroundColor Yellow
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
