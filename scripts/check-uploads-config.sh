#!/bin/bash

# Check uploads configuration on production server
echo "========================================="
echo "🔍 Checking Uploads Configuration"
echo "========================================="
echo ""

# Check if uploads directory exists
echo "1. Checking uploads directory..."
if [ -d "/root/FreeTalkAPI/uploads" ]; then
    echo "   ✅ Directory exists: /root/FreeTalkAPI/uploads"
    
    # Check permissions
    echo ""
    echo "2. Checking permissions..."
    ls -la /root/FreeTalkAPI/uploads | head -n 5
    
    # Count files
    echo ""
    echo "3. Counting files..."
    total_files=$(find /root/FreeTalkAPI/uploads -type f | wc -l)
    echo "   Total files: $total_files"
    
    # Check for feedBanner files
    echo ""
    echo "4. Looking for feedBanner files..."
    feedbanner_count=$(find /root/FreeTalkAPI/uploads -type f -name "feedBanner*" | wc -l)
    if [ $feedbanner_count -gt 0 ]; then
        echo "   ✅ Found $feedbanner_count feedBanner files:"
        find /root/FreeTalkAPI/uploads -type f -name "feedBanner*" -exec ls -lh {} \;
    else
        echo "   ❌ No feedBanner files found"
    fi
    
    # Check most recent uploads
    echo ""
    echo "5. Most recent uploads (last 10)..."
    find /root/FreeTalkAPI/uploads -type f -printf '%T+ %p\n' | sort -r | head -n 10
    
else
    echo "   ❌ Directory not found: /root/FreeTalkAPI/uploads"
fi

# Check nginx configuration
echo ""
echo "========================================="
echo "6. Checking nginx configuration..."
echo "========================================="
if [ -f "/etc/nginx/sites-available/freetalk.site" ]; then
    echo "   ✅ Nginx config exists"
    echo ""
    echo "   Looking for /api/uploads/ location block..."
    if grep -q "location /api/uploads/" /etc/nginx/sites-available/freetalk.site; then
        echo "   ✅ Found /api/uploads/ location block"
        echo ""
        echo "   Configuration:"
        grep -A 15 "location /api/uploads/" /etc/nginx/sites-available/freetalk.site
    else
        echo "   ❌ /api/uploads/ location block NOT FOUND!"
        echo ""
        echo "   This is likely causing the 404 error."
        echo "   The nginx config needs to proxy /api/uploads/ requests."
    fi
else
    echo "   ❌ Nginx config not found"
fi

# Check if Node.js is serving uploads correctly
echo ""
echo "========================================="
echo "7. Testing local uploads access..."
echo "========================================="
echo "   Testing: http://localhost:5000/uploads/"

# Get a sample file to test with
sample_file=$(find /root/FreeTalkAPI/uploads -type f -name "*.jpg" | head -n 1 | xargs basename)
if [ ! -z "$sample_file" ]; then
    echo "   Sample file: $sample_file"
    response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5000/uploads/$sample_file")
    if [ "$response" = "200" ]; then
        echo "   ✅ Node.js server responds: $response OK"
    else
        echo "   ❌ Node.js server responds: $response (Expected 200)"
    fi
else
    echo "   ⚠️  No sample files found to test"
fi

# Check if nginx is proxying correctly
echo ""
echo "8. Testing nginx proxy..."
if [ ! -z "$sample_file" ]; then
    response=$(curl -s -o /dev/null -w "%{http_code}" "https://freetalk.site/api/uploads/$sample_file")
    if [ "$response" = "200" ]; then
        echo "   ✅ Nginx proxy responds: $response OK"
    else
        echo "   ❌ Nginx proxy responds: $response (Expected 200)"
        echo "   This confirms the 404 issue!"
    fi
else
    echo "   ⚠️  No sample files found to test"
fi

echo ""
echo "========================================="
echo "✅ Diagnostic complete!"
echo "========================================="
