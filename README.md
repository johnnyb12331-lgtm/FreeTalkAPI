# FreeTalk Backend API

FreeTalk backend API server with HTTPS support for production deployment on DigitalOcean.

## 🌐 Production URL

**Domain:** https://freetalk.site

## 📁 Project Structure

```
FreeTalkAPI/
├── server.js                 # Main server file with HTTPS support
├── .env                      # Environment variables (DO NOT COMMIT)
├── .env.example              # Environment variables template
├── ecosystem.config.js       # PM2 configuration for production
├── package.json              # Dependencies
├── config/                   # Configuration files
├── middleware/               # Express middleware
├── models/                   # MongoDB models
├── routes/                   # API routes
├── uploads/                  # User uploaded files
└── docs/
    ├── DEPLOYMENT_CHECKLIST.md      # Pre-deployment checklist
    ├── DIGITALOCEAN_DEPLOYMENT.md   # Complete deployment guide
    └── HTTPS_SETUP_GUIDE.md         # SSL/HTTPS configuration
```

## 🚀 Quick Start (Local Development)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   # Create .env file
   cp .env.example .env
   
   # Edit .env with your settings
   # Make sure NODE_ENV=development for local testing
   ```

3. **Start MongoDB:**
   ```bash
   # Make sure MongoDB is running locally
   mongod
   ```

4. **Run the server:**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

5. **Test the API:**
   ```bash
   curl http://localhost:5000/health
   ```

## 📦 Production Deployment

### Prerequisites
- DigitalOcean account
- Domain: `freetalk.site` pointing to your server
- Basic knowledge of Linux/SSH

### Deployment Steps

1. **Review the checklist:**
   ```bash
   See: DEPLOYMENT_CHECKLIST.md
   ```

2. **Follow the deployment guide:**
   ```bash
   See: DIGITALOCEAN_DEPLOYMENT.md
   ```

3. **Configure SSL/HTTPS:**
   ```bash
   See: HTTPS_SETUP_GUIDE.md
   ```

### Quick Deploy Commands (on server)

```bash
# Install dependencies
npm install --production

# Start with PM2
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup auto-start on boot
pm2 startup
```

## 🔧 Environment Variables

Key environment variables (see `.env.example` for all):

```env
NODE_ENV=production
PORT=5000
USE_HTTPS=false  # Set to false when using Nginx
ALLOWED_ORIGINS=https://freetalk.site,https://www.freetalk.site
MONGODB_URI=mongodb://localhost:27017/freetalk
JWT_SECRET=your_strong_secret_here
```

## 📡 API Endpoints

### Health Check
```bash
GET /health
Response: {"status":"ok","message":"Server is running",...}
```

### Auth Routes
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### User Routes
- `GET /api/users/:id` - Get user profile
- `PUT /api/users/:id` - Update user profile
- `GET /api/users` - Search users

### Posts Routes
- `GET /api/posts` - Get all posts
- `POST /api/posts` - Create new post
- `PUT /api/posts/:id` - Update post
- `DELETE /api/posts/:id` - Delete post

### Messages Routes
- `GET /api/messages/:conversationId` - Get messages
- `POST /api/messages` - Send message
- WebSocket: Real-time messaging via Socket.IO

### Stories Routes
- `GET /api/stories` - Get all stories
- `POST /api/stories` - Create story
- `DELETE /api/stories/:id` - Delete story

### Calls Routes
- `POST /api/calls/initiate` - Start call
- WebSocket: WebRTC signaling via Socket.IO

And more... (see routes/ directory)

## 🔒 Security Features

- ✅ HTTPS/SSL support
- ✅ JWT authentication
- ✅ Rate limiting
- ✅ CORS configuration
- ✅ Input validation
- ✅ MongoDB injection prevention
- ✅ XSS protection headers

## 🛠️ Available Scripts

```bash
npm start          # Start production server
npm run dev        # Start development server with nodemon
```

## 📊 Monitoring (Production)

### PM2 Commands
```bash
pm2 status                  # Check app status
pm2 logs freetalk-api       # View logs
pm2 restart freetalk-api    # Restart app
pm2 monit                   # Monitor resources
```

### Check Logs
```bash
# Application logs
pm2 logs freetalk-api

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log
```

## 🔄 Updating Production

```bash
# SSH into server
ssh user@freetalk.site

# Navigate to app directory
cd ~/FreeTalkApp/FreeTalkAPI

# Pull latest changes
git pull origin main

# Install dependencies
npm install --production

# Restart application
pm2 restart freetalk-api

# Check for errors
pm2 logs freetalk-api --lines 50
```

## 📚 Documentation

- **[DEPLOYMENT_CHECKLIST.md](./docs/DEPLOYMENT_CHECKLIST.md)** - Pre-deployment checklist
- **[DIGITALOCEAN_DEPLOYMENT.md](./docs/DIGITALOCEAN_DEPLOYMENT.md)** - Complete deployment guide
- **[HTTPS_SETUP_GUIDE.md](./docs/HTTPS_SETUP_GUIDE.md)** - SSL/HTTPS configuration

## 🐛 Troubleshooting

### App won't start
```bash
pm2 logs freetalk-api  # Check for errors
node server.js         # Run directly to see errors
```

### Can't connect to database
```bash
sudo systemctl status mongod
sudo systemctl restart mongod
```

### SSL/HTTPS issues
```bash
sudo certbot certificates  # Check certificate
sudo nginx -t              # Test Nginx config
```

For more troubleshooting tips, see `DIGITALOCEAN_DEPLOYMENT.md`

## 📞 Support

- Check application logs: `pm2 logs`
- Test API endpoint: `curl https://freetalk.site/health`
- Review documentation in the docs/ folder

## 📝 License

ISC

---

**Status:** ✅ Ready for production deployment on DigitalOcean

Last updated: October 6, 2025
