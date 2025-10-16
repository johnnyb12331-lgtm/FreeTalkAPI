#!/bin/bash

echo "🚀 FreeTalk API Server Setup Script"
echo "===================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Please run as root (use: sudo bash setup-api-server.sh)"
    exit 1
fi

# Install Node.js (using NodeSource repository for latest LTS)
echo "📦 Installing Node.js..."
if ! command -v node &> /dev/null; then
    # Install Node.js 20.x LTS
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    echo "✅ Node.js installed: $(node --version)"
    echo "✅ NPM installed: $(npm --version)"
else
    echo "✅ Node.js already installed: $(node --version)"
fi
echo ""

# Install PM2 globally
echo "📦 Installing PM2 process manager..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
    echo "✅ PM2 installed"
else
    echo "✅ PM2 already installed"
fi
echo ""

# Navigate to API directory
cd /root/FreeTalkAPI || {
    echo "❌ FreeTalkAPI directory not found at /root/FreeTalkAPI"
    echo "Please clone your repository first:"
    echo "  cd /root && git clone https://github.com/johnnyb12331-lgtm/FreeTalkAPI.git"
    exit 1
}

echo "📂 Working directory: $(pwd)"
echo ""

# Install dependencies
echo "📦 Installing API dependencies..."
npm install
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating template..."
    cat > .env << 'EOL'
NODE_ENV=production
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here
ALLOWED_ORIGINS=https://freetalk.site,https://www.freetalk.site,http://167.71.97.187
APP_URL=https://freetalk.site

# Add other required environment variables
EOL
    echo "⚠️  Please edit .env file with your actual credentials"
    echo "    nano .env"
    exit 1
fi

echo "✅ .env file found"
echo ""

# Start the API with PM2
echo "🚀 Starting FreeTalk API with PM2..."
pm2 delete freetalk-api 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo ""
echo "✅ API Server Setup Complete!"
echo ""
echo "📊 PM2 Status:"
pm2 list
echo ""
echo "📝 View logs with: pm2 logs freetalk-api"
echo "🔄 Restart with: pm2 restart freetalk-api"
echo "⏹️  Stop with: pm2 stop freetalk-api"
echo ""

# Test the API
echo "🧪 Testing API endpoint..."
sleep 3
curl -s http://localhost:5000/health | jq . 2>/dev/null || curl -s http://localhost:5000/health

echo ""
echo "✅ Setup complete! Your API should now be accessible at https://freetalk.site/api"
