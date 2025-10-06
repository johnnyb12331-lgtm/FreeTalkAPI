# HTTPS Setup Guide for FreeTalk Backend

This guide will help you set up HTTPS for your FreeTalk backend API using your domain `https://freetalk.site/`.

## Prerequisites

1. A server (VPS, AWS EC2, DigitalOcean Droplet, etc.) with:
   - Ubuntu 20.04+ or similar Linux distribution
   - Root or sudo access
   - Port 80 and 443 open in firewall
   - Domain `freetalk.site` pointing to your server's IP address

2. Node.js and npm installed on the server

## Step 1: Point Your Domain to Your Server

1. Log in to your domain registrar (where you bought freetalk.site)
2. Add an A record pointing to your server's IP address:
   ```
   Type: A
   Name: @
   Value: YOUR_SERVER_IP
   TTL: 3600
   ```
3. Optionally, add a www subdomain:
   ```
   Type: A
   Name: www
   Value: YOUR_SERVER_IP
   TTL: 3600
   ```
4. Wait for DNS propagation (can take 5 minutes to 48 hours)
5. Verify with: `ping freetalk.site`

## Step 2: Install Certbot (Let's Encrypt SSL Certificate)

Let's Encrypt provides free SSL certificates that auto-renew.

### On Ubuntu/Debian:

```bash
# Update package list
sudo apt update

# Install Certbot and Nginx (we'll use Nginx as reverse proxy)
sudo apt install certbot python3-certbot-nginx nginx -y
```

### On CentOS/RHEL:

```bash
sudo yum install certbot python3-certbot-nginx nginx -y
```

## Step 3: Obtain SSL Certificate

```bash
# Stop Nginx temporarily if it's running
sudo systemctl stop nginx

# Obtain certificate using standalone method
sudo certbot certonly --standalone -d freetalk.site -d www.freetalk.site

# Or use webroot method if you have a web server running
sudo certbot certonly --webroot -w /var/www/html -d freetalk.site -d www.freetalk.site
```

Follow the prompts:
- Enter your email address
- Agree to terms of service
- Choose whether to share email with EFF

Your certificates will be saved at:
- **Certificate**: `/etc/letsencrypt/live/freetalk.site/fullchain.pem`
- **Private Key**: `/etc/letsencrypt/live/freetalk.site/privkey.pem`

## Step 4: Configure Your Backend

1. Copy the `.env.example` file to `.env`:
   ```bash
   cd /path/to/FreeTalkAPI
   cp .env.example .env
   ```

2. Edit the `.env` file:
   ```bash
   nano .env
   ```

3. Set the following values:
   ```env
   NODE_ENV=production
   PORT=5000
   USE_HTTPS=true
   SSL_KEY_PATH=/etc/letsencrypt/live/freetalk.site/privkey.pem
   SSL_CERT_PATH=/etc/letsencrypt/live/freetalk.site/fullchain.pem
   ALLOWED_ORIGINS=https://freetalk.site,https://www.freetalk.site
   ```

4. Make sure your Node.js app can access the certificates:
   ```bash
   # Give read permissions (be careful with security)
   sudo chmod 644 /etc/letsencrypt/live/freetalk.site/fullchain.pem
   sudo chmod 644 /etc/letsencrypt/live/freetalk.site/privkey.pem
   sudo chmod 755 /etc/letsencrypt/live/
   sudo chmod 755 /etc/letsencrypt/archive/
   ```

   Or run your Node.js app with sudo (not recommended), or add your user to ssl-cert group:
   ```bash
   sudo usermod -a -G ssl-cert $USER
   sudo chgrp ssl-cert /etc/letsencrypt/live/freetalk.site/privkey.pem
   sudo chmod 640 /etc/letsencrypt/live/freetalk.site/privkey.pem
   ```

## Step 5: Setup Nginx as Reverse Proxy (Recommended)

Instead of running Node.js with sudo, use Nginx as a reverse proxy:

1. Create Nginx configuration:
   ```bash
   sudo nano /etc/nginx/sites-available/freetalk
   ```

2. Add this configuration:
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

       # SSL Configuration
       ssl_certificate /etc/letsencrypt/live/freetalk.site/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/freetalk.site/privkey.pem;
       
       # SSL Security Settings
       ssl_protocols TLSv1.2 TLSv1.3;
       ssl_ciphers HIGH:!aNULL:!MD5;
       ssl_prefer_server_ciphers on;

       # File upload size limit
       client_max_body_size 50M;

       # Proxy settings
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
           alias /path/to/FreeTalkAPI/uploads;
           expires 30d;
           add_header Cache-Control "public, immutable";
       }
   }
   ```

3. Enable the site:
   ```bash
   sudo ln -s /etc/nginx/sites-available/freetalk /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

4. Update your `.env` to use HTTP since Nginx handles HTTPS:
   ```env
   USE_HTTPS=false
   PORT=5000
   ```

## Step 6: Setup PM2 for Process Management

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start your application
cd /path/to/FreeTalkAPI
pm2 start server.js --name freetalk-api

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Run the command that PM2 outputs
```

## Step 7: Configure Firewall

```bash
# Allow SSH
sudo ufw allow ssh

# Allow HTTP and HTTPS
sudo ufw allow 80
sudo ufw allow 443

# Enable firewall
sudo ufw enable
```

## Step 8: Auto-Renewal Setup

Certbot automatically sets up a cron job for renewal. Test it:

```bash
# Test renewal
sudo certbot renew --dry-run

# Manual renewal if needed
sudo certbot renew

# Restart Nginx after renewal
sudo systemctl reload nginx
```

## Step 9: Test Your Setup

1. Test HTTPS connection:
   ```bash
   curl https://freetalk.site
   ```

2. Test from browser: Visit `https://freetalk.site`

3. Check SSL certificate: https://www.ssllabs.com/ssltest/analyze.html?d=freetalk.site

## Alternative: Using Cloudflare (Easier Option)

If you want easier SSL management:

1. Sign up for Cloudflare (free)
2. Add your domain to Cloudflare
3. Update nameservers at your registrar
4. Enable "Full (Strict)" SSL in Cloudflare dashboard
5. Cloudflare provides SSL automatically
6. Set `USE_HTTPS=false` in your `.env` and let Cloudflare handle SSL

## Troubleshooting

### Certificate Permission Issues
```bash
# Check certificate access
sudo ls -la /etc/letsencrypt/live/freetalk.site/

# If using Node.js directly, run with sudo (not recommended)
sudo npm start

# Or fix permissions
sudo chmod -R 755 /etc/letsencrypt/live/
sudo chmod -R 755 /etc/letsencrypt/archive/
```

### Port Already in Use
```bash
# Check what's using port 443
sudo netstat -tulpn | grep :443
sudo lsof -i :443

# Kill the process if needed
sudo kill -9 <PID>
```

### DNS Not Resolving
```bash
# Check DNS propagation
nslookup freetalk.site
dig freetalk.site

# Wait for DNS to propagate (can take up to 48 hours)
```

### Socket.IO Connection Issues

If Socket.IO connections fail over HTTPS:
1. Make sure CORS is properly configured with your domain
2. Ensure WebSocket upgrades are allowed in Nginx
3. Check browser console for errors
4. Verify `transports` configuration in Socket.IO

## Security Best Practices

1. **Keep certificates updated**: Certbot auto-renews, but monitor it
2. **Use strong JWT secrets**: Change `JWT_SECRET` in `.env`
3. **Enable rate limiting**: Already configured in your app
4. **Regular backups**: Backup your MongoDB database regularly
5. **Monitor logs**: `pm2 logs freetalk-api`
6. **Use environment variables**: Never commit `.env` to git
7. **Update dependencies**: Run `npm audit` and `npm update` regularly

## Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs freetalk-api`
2. Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
3. Test SSL: `sudo certbot certificates`
4. Verify DNS: `nslookup freetalk.site`

Good luck with your deployment! 🚀
