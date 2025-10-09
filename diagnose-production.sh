#!/bin/bash

# Diagnostic script for FreeTalk API video endpoint issue
# Run this on your DigitalOcean server

echo "🔍 FreeTalk API Diagnostics"
echo "================================"
echo ""

# Check MongoDB status
echo "1️⃣ Checking MongoDB status..."
sudo systemctl status mongod | grep "Active:"
echo ""

# Check PM2 processes
echo "2️⃣ Checking PM2 processes..."
pm2 list
echo ""

# Check recent PM2 logs for errors
echo "3️⃣ Recent API logs (last 30 lines)..."
pm2 logs freetalk-api --lines 30 --nostream
echo ""

# Test MongoDB connection
echo "4️⃣ Testing MongoDB connection..."
mongo --eval "db.adminCommand('ping')" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ MongoDB is responding"
else
    echo "❌ MongoDB is not responding"
fi
echo ""

# Check disk space
echo "5️⃣ Checking disk space..."
df -h | grep -E "Filesystem|/$"
echo ""

# Check memory usage
echo "6️⃣ Checking memory usage..."
free -h
echo ""

# Test API health endpoint
echo "7️⃣ Testing API health endpoint..."
curl -s http://localhost:5000/health | json_pp 2>/dev/null || curl -s http://localhost:5000/health
echo ""
echo ""

# Check environment variables
echo "8️⃣ Checking if .env file exists..."
if [ -f "/var/www/FreeTalkAPI/.env" ]; then
    echo "✅ .env file exists"
    echo "   JWT_SECRET: $(grep JWT_SECRET /var/www/FreeTalkAPI/.env | cut -d'=' -f1)"
    echo "   MONGODB_URI: $(grep MONGODB_URI /var/www/FreeTalkAPI/.env | cut -d'=' -f1)"
    echo "   PORT: $(grep PORT /var/www/FreeTalkAPI/.env | cut -d'=' -f1)"
else
    echo "❌ .env file not found"
fi
echo ""

# Check MongoDB collections
echo "9️⃣ Checking MongoDB collections..."
mongo FreeTalk --eval "db.getCollectionNames()" --quiet
echo ""

echo "================================"
echo "✅ Diagnostics complete!"
echo ""
echo "To fix common issues:"
echo "  • MongoDB not running: sudo systemctl start mongod"
echo "  • Restart API: pm2 restart freetalk-api"
echo "  • View live logs: pm2 logs freetalk-api"
