#!/bin/bash

# Quick test script for feed banner uploads
# Run this on your production server

echo "========================================="
echo "🧪 Testing Feed Banner Upload Flow"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Check if uploads directory exists
echo "Test 1: Uploads directory..."
if [ -d "/root/FreeTalkAPI/uploads" ]; then
    echo -e "${GREEN}✅ PASS${NC}: Directory exists"
else
    echo -e "${RED}❌ FAIL${NC}: Directory not found"
    exit 1
fi

# Test 2: Check directory permissions
echo ""
echo "Test 2: Directory permissions..."
perms=$(stat -c %a /root/FreeTalkAPI/uploads)
if [ "$perms" = "755" ] || [ "$perms" = "775" ] || [ "$perms" = "777" ]; then
    echo -e "${GREEN}✅ PASS${NC}: Permissions are $perms"
else
    echo -e "${YELLOW}⚠️  WARNING${NC}: Permissions are $perms (recommended: 755)"
fi

# Test 3: Check if Node.js server is running
echo ""
echo "Test 3: Node.js server status..."
if pm2 list | grep -q "FreeTalkAPI.*online"; then
    echo -e "${GREEN}✅ PASS${NC}: Server is running"
else
    echo -e "${RED}❌ FAIL${NC}: Server is not running"
    echo "   Run: pm2 start ecosystem.config.js"
    exit 1
fi

# Test 4: Check if Node.js serves uploads
echo ""
echo "Test 4: Node.js uploads endpoint..."
# Get a sample file
sample_file=$(find /root/FreeTalkAPI/uploads -type f \( -name "avatar-*.jpg" -o -name "media-*.jpg" \) | head -n 1 | xargs basename)
if [ ! -z "$sample_file" ]; then
    response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5000/uploads/$sample_file")
    if [ "$response" = "200" ]; then
        echo -e "${GREEN}✅ PASS${NC}: Node.js serves files (HTTP $response)"
    else
        echo -e "${RED}❌ FAIL${NC}: Got HTTP $response (expected 200)"
        echo "   File tested: $sample_file"
    fi
else
    echo -e "${YELLOW}⚠️  SKIP${NC}: No sample files found"
fi

# Test 5: Check nginx configuration for /api/uploads/
echo ""
echo "Test 5: Nginx /api/uploads/ configuration..."
if grep -q "location /api/uploads/" /etc/nginx/sites-available/freetalk.site; then
    echo -e "${GREEN}✅ PASS${NC}: Location block exists"
    
    # Check if it has the rewrite directive
    if grep -A 5 "location /api/uploads/" /etc/nginx/sites-available/freetalk.site | grep -q "rewrite"; then
        echo -e "${GREEN}   ✅ Has rewrite directive${NC}"
    else
        echo -e "${RED}   ❌ Missing rewrite directive${NC}"
    fi
else
    echo -e "${RED}❌ FAIL${NC}: Location block not found"
    echo "   You need to add the /api/uploads/ location block to nginx"
    echo "   See: /root/FreeTalkAPI/FIX_FEEDBANNER_404.md"
fi

# Test 6: Check if nginx can proxy the request
echo ""
echo "Test 6: Nginx proxy test..."
if [ ! -z "$sample_file" ]; then
    response=$(curl -s -o /dev/null -w "%{http_code}" "https://freetalk.site/api/uploads/$sample_file")
    if [ "$response" = "200" ]; then
        echo -e "${GREEN}✅ PASS${NC}: Nginx proxies correctly (HTTP $response)"
    else
        echo -e "${RED}❌ FAIL${NC}: Got HTTP $response (expected 200)"
        echo "   This is the issue causing your 404 errors!"
        echo "   File tested: https://freetalk.site/api/uploads/$sample_file"
    fi
else
    echo -e "${YELLOW}⚠️  SKIP${NC}: No sample files found"
fi

# Test 7: Check if feed banner route exists
echo ""
echo "Test 7: Feed banner upload route..."
if grep -q "feed-banner" /root/FreeTalkAPI/routes/user.js; then
    echo -e "${GREEN}✅ PASS${NC}: Route exists in user.js"
else
    echo -e "${RED}❌ FAIL${NC}: Route not found"
fi

# Summary
echo ""
echo "========================================="
echo "📊 Test Summary"
echo "========================================="
echo ""

# Count passes and fails
passes=$(grep -c "✅ PASS" <<EOF
$(cat)
EOF 2>/dev/null || echo "0")

if [ "$response" = "200" ] && [ -d "/root/FreeTalkAPI/uploads" ]; then
    echo -e "${GREEN}🎉 All critical tests passed!${NC}"
    echo ""
    echo "Your feed banner uploads should work correctly."
    echo "If you're still seeing 404 errors:"
    echo "1. Clear your browser cache"
    echo "2. Try uploading a new image"
    echo "3. Check browser DevTools for the actual URL being requested"
else
    echo -e "${RED}⚠️  Some tests failed!${NC}"
    echo ""
    echo "Please review the failures above and follow the fix guide:"
    echo "   /root/FreeTalkAPI/FIX_FEEDBANNER_404.md"
fi

echo ""
