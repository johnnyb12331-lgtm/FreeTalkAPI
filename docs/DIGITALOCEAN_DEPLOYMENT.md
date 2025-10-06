# DigitalOcean Deployment Guide for FreeTalk Backend

Complete step-by-step guide to deploy your FreeTalk backend API to DigitalOcean with domain `https://freetalk.site/`.

---

## 🚀 Prerequisites

- DigitalOcean account
- Domain `freetalk.site` (already purchased)
- SSH client (PowerShell, PuTTY, or Terminal)
- Git installed locally

---

## Step 1: Create a DigitalOcean Droplet

1. **Log in to DigitalOcean** at https://cloud.digitalocean.com

2. **Create a new Droplet:**
   - Click "Create" → "Droplets"
   - Choose an image: **Ubuntu 22.04 (LTS) x64**
   - Choose a plan:
     - Basic: $6/month (1GB RAM, 1 vCPU) - For testing
     - Regular: $12/month (2GB RAM, 1 vCPU) - Recommended for small apps
     - Premium: $18/month (2GB RAM, 2 vCPU) - For production
   
3. **Choose a datacenter region:**
   - Select closest to your users (e.g., New York, San Francisco, London)

4. **Authentication:**
   - Choose "SSH keys" (more secure) or "Password"
   - If SSH: Add your SSH public key
   - If Password: Use a strong password

5. **Finalize:**
   - Choose a hostname: `freetalk-api`
   - Click "Create Droplet"
   - Wait 1-2 minutes for creation
   - Note your droplet's IP address

---

## Step 2: Point Your Domain to the Droplet

1. **Log in to your domain registrar** (where you bought freetalk.site)

2. **Update DNS records:**
   ```
   Type: A
   Name: @
   Value: YOUR_DROPLET_IP_ADDRESS
   TTL: 3600
   
   Type: A
   Name: www
   Value: YOUR_DROPLET_IP_ADDRESS
   TTL: 3600
   ```

3. **Wait for DNS propagation** (5 minutes to 48 hours, usually 15-30 minutes)

4. **Verify DNS propagation:**
   ```bash
   ping freetalk.site
   ```

---

## Step 3: Initial Server Setup

1. **SSH into your droplet:**
   ```bash
   ssh root@YOUR_DROPLET_IP
   # If using password, enter it when prompted
   ```

2. **Update the system:**
   ```bash
   apt update && apt upgrade -y
   ```

3. **Create a new user (recommended for security):**
   ```bash
   adduser freetalk
   usermod -aG sudo freetalk
   
   # Copy SSH keys to new user (if using SSH)
   rsync --archive --chown=freetalk:freetalk ~/.ssh /home/freetalk
   
   # Switch to new user
   su - freetalk
   ```

4. **Install Node.js:**
   ```bash
   # Install Node.js 20.x (LTS)
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Verify installation
   node --version
   npm --version
   ```

5. **Install MongoDB:**
   ```bash
   # Import MongoDB public GPG key
   curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
   
   # Add MongoDB repository
   echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
   
   # Update package list and install MongoDB
   sudo apt-get update
   sudo apt-get install -y mongodb-org
   
   # Start MongoDB
   sudo systemctl start mongod
   sudo systemctl enable mongod
   
   # Verify MongoDB is running
   sudo systemctl status mongod
   ```

6. **Install PM2 (Process Manager):**
   ```bash
   sudo npm install -g pm2
   ```

7. **Install Nginx:**
   ```bash
   sudo apt install nginx -y
   sudo systemctl enable nginx
   ```

8. **Configure Firewall:**
   ```bash
   sudo ufw allow OpenSSH
   sudo ufw allow 'Nginx Full'
   sudo ufw enable
   sudo ufw status
   ```

---

## Step 4: Upload Your Backend Code

### Option A: Using Git (Recommended)

1. **Install Git:**
   ```bash
   sudo apt install git -y
   ```

2. **Clone your repository:**
   ```bash
   cd ~
   git clone https://github.com/johnnyb12331-lgtm/FreeTalkApp.git
   cd FreeTalkApp/FreeTalkAPI
   ```

3. **Install dependencies:**
   ```bash
   npm install --production
   ```

### Option B: Using SCP/SFTP

1. **From your local machine:**
   ```powershell
   # Compress the FreeTalkAPI folder (excluding node_modules)
   # Then upload using SCP
   scp -r C:\Users\benne\OneDrive\Desktop\Best\FreeTalkApp\FreeTalkAPI root@YOUR_DROPLET_IP:/home/freetalk/
   ```

2. **On the server:**
   ```bash
   cd /home/freetalk/FreeTalkAPI
   npm install --production
   ```

---

## Step 5: Configure Environment Variables

1. **Create and edit .env file:**
   ```bash
   cd ~/FreeTalkApp/FreeTalkAPI
   nano .env
   ```

2. **Add your production configuration:**
   ```env
   # Server Configuration
   PORT=5000
   
   # Environment
   NODE_ENV=production
   
   # HTTPS Configuration (we'll use Nginx for SSL, so set to false)
   USE_HTTPS=false
   
   # CORS Configuration
   ALLOWED_ORIGINS=https://freetalk.site,https://www.freetalk.site
   
   # MongoDB Configuration
   MONGODB_URI=mongodb://localhost:27017/freetalk
   
   # JWT Secret - CHANGE THIS TO A STRONG RANDOM STRING
   JWT_SECRET=CHANGE_THIS_TO_A_VERY_STRONG_RANDOM_SECRET_STRING_123456789abcdefg
   
   # Stripe (if using payments)
   STRIPE_SECRET_KEY=your_stripe_secret_key
   ```

3. **Generate a strong JWT secret:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   # Copy the output and use it as JWT_SECRET
   ```

4. **Save and exit:** Press `Ctrl+X`, then `Y`, then `Enter`

---

## Step 6: Obtain SSL Certificate (Let's Encrypt)

1. **Install Certbot:**
   ```bash
   sudo apt install certbot python3-certbot-nginx -y
   ```

2. **Obtain SSL certificate:**
   ```bash
   sudo certbot --nginx -d freetalk.site -d www.freetalk.site
   ```

3. **Follow the prompts:**
   - Enter your email address
   - Agree to terms of service
   - Choose whether to redirect HTTP to HTTPS (choose Yes/2)

4. **Verify certificate:**
   ```bash
   sudo certbot certificates
   ```

---

## Step 7: Configure Nginx as Reverse Proxy

1. **Create Nginx configuration:**
   ```bash
   sudo nano /etc/nginx/sites-available/freetalk
   ```

2. **Add this configuration:**
   ```nginx
   server {
       listen 80;
       server_name freetalk.site www.freetalk.site;
       
       # Redirect HTTP to HTTPS
       return 301 https://$server_name$request_uri;
   }

   server {
       listen 443 ssl http2;
       server_name freetalk.site www.freetalk.site;

       # SSL Configuration (Certbot will add these)
       ssl_certificate /etc/letsencrypt/live/freetalk.site/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/freetalk.site/privkey.pem;
       include /etc/letsencrypt/options-ssl-nginx.conf;
       ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

       # Security headers
       add_header X-Frame-Options "SAMEORIGIN" always;
       add_header X-Content-Type-Options "nosniff" always;
       add_header X-XSS-Protection "1; mode=block" always;
       add_header Referrer-Policy "no-referrer-when-downgrade" always;

       # File upload size limit
       client_max_body_size 50M;

       # Proxy to Node.js backend
       location / {
           proxy_pass http://localhost:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
           
           # Socket.IO support
           proxy_set_header X-Forwarded-Host $server_name;
           proxy_read_timeout 86400;
       }

       # Static files (uploads)
       location /uploads {
           alias /home/freetalk/FreeTalkApp/FreeTalkAPI/uploads;
           expires 30d;
           add_header Cache-Control "public, immutable";
       }
   }
   ```

3. **Enable the site:**
   ```bash
   sudo ln -s /etc/nginx/sites-available/freetalk /etc/nginx/sites-enabled/
   sudo rm /etc/nginx/sites-enabled/default  # Remove default site
   ```

4. **Test Nginx configuration:**
   ```bash
   sudo nginx -t
   ```

5. **Restart Nginx:**
   ```bash
   sudo systemctl restart nginx
   ```

---

## Step 8: Start Your Application with PM2

1. **Navigate to your app directory:**
   ```bash
   cd ~/FreeTalkApp/FreeTalkAPI
   ```

2. **Create logs directory:**
   ```bash
   mkdir -p logs
   ```

3. **Start the application:**
   ```bash
   pm2 start ecosystem.config.js --env production
   ```

4. **Save PM2 configuration:**
   ```bash
   pm2 save
   ```

5. **Setup PM2 to start on boot:**
   ```bash
   pm2 startup
   # Run the command that PM2 outputs (it will be something like):
   # sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u freetalk --hp /home/freetalk
   ```

6. **Verify application is running:**
   ```bash
   pm2 status
   pm2 logs freetalk-api
   ```

---

## Step 9: Test Your Deployment

1. **Check health endpoint:**
   ```bash
   curl https://freetalk.site/health
   ```
   You should see: `{"status":"ok","message":"Server is running",...}`

2. **Open in browser:**
   - Visit: https://freetalk.site
   - Visit: https://freetalk.site/health

3. **Check SSL certificate:**
   - Visit: https://www.ssllabs.com/ssltest/analyze.html?d=freetalk.site

4. **Test API endpoints:**
   ```bash
   curl https://freetalk.site/api/auth/test
   ```

---

## Step 10: Secure MongoDB (Optional but Recommended)

1. **Enable MongoDB authentication:**
   ```bash
   mongosh
   ```

2. **Create admin user:**
   ```javascript
   use admin
   db.createUser({
     user: "admin",
     pwd: "STRONG_PASSWORD_HERE",
     roles: ["userAdminAnyDatabase", "dbAdminAnyDatabase", "readWriteAnyDatabase"]
   })
   exit
   ```

3. **Create database user:**
   ```bash
   mongosh
   ```
   ```javascript
   use freetalk
   db.createUser({
     user: "freetalkuser",
     pwd: "ANOTHER_STRONG_PASSWORD",
     roles: ["readWrite"]
   })
   exit
   ```

4. **Enable authentication:**
   ```bash
   sudo nano /etc/mongod.conf
   ```
   Add:
   ```yaml
   security:
     authorization: enabled
   ```

5. **Restart MongoDB:**
   ```bash
   sudo systemctl restart mongod
   ```

6. **Update .env with MongoDB credentials:**
   ```env
   MONGODB_URI=mongodb://freetalkuser:ANOTHER_STRONG_PASSWORD@localhost:27017/freetalk?authSource=freetalk
   ```

7. **Restart your app:**
   ```bash
   pm2 restart freetalk-api
   ```

---

## 📊 Useful PM2 Commands

```bash
# View application status
pm2 status

# View logs
pm2 logs freetalk-api
pm2 logs freetalk-api --lines 100

# Restart application
pm2 restart freetalk-api

# Stop application
pm2 stop freetalk-api

# Delete application from PM2
pm2 delete freetalk-api

# Monitor CPU/Memory usage
pm2 monit

# View detailed info
pm2 info freetalk-api
```

---

## 🔄 Deploying Updates

When you make changes to your code:

```bash
# SSH into server
ssh freetalk@YOUR_DROPLET_IP

# Navigate to app directory
cd ~/FreeTalkApp/FreeTalkAPI

# Pull latest changes (if using Git)
git pull origin main

# Install any new dependencies
npm install --production

# Restart the application
pm2 restart freetalk-api

# Check logs for any errors
pm2 logs freetalk-api --lines 50
```

---

## 🔍 Monitoring and Logs

### View Application Logs:
```bash
pm2 logs freetalk-api
pm2 logs freetalk-api --err  # Only errors
pm2 logs freetalk-api --out  # Only output
```

### View Nginx Logs:
```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### View MongoDB Logs:
```bash
sudo tail -f /var/log/mongodb/mongod.log
```

### Check System Resources:
```bash
htop  # Install with: sudo apt install htop
df -h  # Disk space
free -h  # Memory usage
```

---

## 🛡️ Security Checklist

- ✅ SSL certificate installed and auto-renewing
- ✅ Firewall (UFW) configured
- ✅ MongoDB authentication enabled
- ✅ Strong JWT secret set
- ✅ .env file not committed to Git
- ✅ Regular backups scheduled
- ✅ Non-root user created
- ✅ SSH key authentication (if possible)
- ✅ Rate limiting enabled (already in your app)
- ✅ CORS properly configured

---

## 🔐 Backup Strategy

### Backup MongoDB:
```bash
# Create backup
mongodump --db freetalk --out ~/backups/mongodb-$(date +%Y%m%d)

# Restore backup
mongorestore --db freetalk ~/backups/mongodb-YYYYMMDD/freetalk
```

### Automated Backup Script:
Create `/home/freetalk/backup.sh`:
```bash
#!/bin/bash
BACKUP_DIR="/home/freetalk/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup MongoDB
mongodump --db freetalk --out $BACKUP_DIR/mongodb-$DATE

# Backup uploads folder
tar -czf $BACKUP_DIR/uploads-$DATE.tar.gz ~/FreeTalkApp/FreeTalkAPI/uploads

# Keep only last 7 days of backups
find $BACKUP_DIR -name "mongodb-*" -mtime +7 -exec rm -rf {} \;
find $BACKUP_DIR -name "uploads-*" -mtime +7 -exec rm -f {} \;

echo "Backup completed: $DATE"
```

Make it executable and add to crontab:
```bash
chmod +x ~/backup.sh
crontab -e
# Add this line to run daily at 2 AM:
0 2 * * * /home/freetalk/backup.sh >> /home/freetalk/backup.log 2>&1
```

---

## 🚨 Troubleshooting

### Application won't start:
```bash
pm2 logs freetalk-api  # Check for errors
node server.js  # Run directly to see errors
```

### Can't connect to MongoDB:
```bash
sudo systemctl status mongod
sudo systemctl restart mongod
mongosh  # Test connection
```

### SSL certificate issues:
```bash
sudo certbot certificates  # Check certificate status
sudo certbot renew  # Manually renew
sudo nginx -t  # Test Nginx config
```

### Nginx errors:
```bash
sudo nginx -t  # Test configuration
sudo systemctl restart nginx
sudo tail -f /var/log/nginx/error.log
```

### Port already in use:
```bash
sudo lsof -i :5000  # Check what's using port 5000
sudo kill -9 <PID>  # Kill the process
pm2 restart freetalk-api
```

---

## 📞 Support

If you need help:
1. Check logs: `pm2 logs freetalk-api`
2. Check Nginx: `sudo tail -f /var/log/nginx/error.log`
3. Check MongoDB: `sudo tail -f /var/log/mongodb/mongod.log`
4. Test endpoints: `curl https://freetalk.site/health`

---

## 🎉 Success!

Your FreeTalk backend is now deployed and running at:
- **API URL:** https://freetalk.site
- **Health Check:** https://freetalk.site/health

Next steps:
1. Update your Flutter app to use the production API URL
2. Test all features thoroughly
3. Monitor logs regularly
4. Set up automated backups
5. Keep your server updated

Good luck! 🚀
