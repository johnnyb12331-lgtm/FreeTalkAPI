# 🚀 Pre-Deployment Checklist

Before deploying to DigitalOcean, make sure you have completed all these items:

## ✅ Configuration Files

- [x] `.env` file configured with production settings
- [x] `.gitignore` created to prevent sensitive files from being committed
- [x] `ecosystem.config.js` created for PM2 process management
- [x] HTTPS/SSL configuration added to `server.js`
- [x] CORS configured for your domain `https://freetalk.site`

## ✅ Code Review

- [ ] All sensitive data removed from code (API keys, passwords, etc.)
- [ ] Environment variables used for all configuration
- [ ] Error handling implemented
- [ ] Health check endpoint working (`/health`)
- [ ] All routes tested locally

## ✅ Dependencies

- [ ] All required npm packages listed in `package.json`
- [ ] No unnecessary dev dependencies in production
- [ ] Package versions locked (package-lock.json committed)

## ✅ Security

- [ ] Strong JWT_SECRET generated (use random string, not default)
- [ ] MongoDB credentials secured
- [ ] Rate limiting configured (already in your app)
- [ ] CORS properly configured for production
- [ ] .env file NOT committed to Git

## ✅ Domain & DNS

- [ ] Domain `freetalk.site` purchased
- [ ] Access to domain registrar to update DNS records
- [ ] DNS A records ready to point to server IP

## ✅ DigitalOcean Account

- [ ] DigitalOcean account created
- [ ] Payment method added
- [ ] SSH key generated (optional but recommended)

## ✅ Required Knowledge

- [ ] Basic Linux/Ubuntu commands
- [ ] SSH connection basics
- [ ] Git basics (if using Git for deployment)

---

## 📋 Deployment Steps Summary

Once you have the checklist complete, follow these steps:

1. **Create DigitalOcean Droplet** (Ubuntu 22.04)
2. **Point domain to droplet IP** (update DNS A records)
3. **SSH into server** and do initial setup
4. **Install required software** (Node.js, MongoDB, PM2, Nginx)
5. **Upload your code** (Git clone or SCP)
6. **Configure .env** file on server
7. **Obtain SSL certificate** (Let's Encrypt)
8. **Configure Nginx** as reverse proxy
9. **Start app with PM2**
10. **Test everything**

Full detailed instructions: See `DIGITALOCEAN_DEPLOYMENT.md`

---

## 🎯 Quick Commands Reference

### On Your Local Machine:
```bash
# Test your app locally first
npm install
npm start

# Check for any errors
curl http://localhost:5000/health
```

### On DigitalOcean Server:
```bash
# SSH into server
ssh root@YOUR_DROPLET_IP

# Check app status
pm2 status

# View logs
pm2 logs freetalk-api

# Restart app
pm2 restart freetalk-api
```

---

## 🔗 Important URLs After Deployment

- API Base: `https://freetalk.site`
- Health Check: `https://freetalk.site/health`
- API Endpoints: `https://freetalk.site/api/...`

---

## 📞 What to Do If Something Goes Wrong

1. **Check PM2 logs:** `pm2 logs freetalk-api`
2. **Check Nginx logs:** `sudo tail -f /var/log/nginx/error.log`
3. **Check MongoDB:** `sudo systemctl status mongod`
4. **Test locally first:** Always test changes locally before deploying
5. **Refer to troubleshooting section** in `docs/DIGITALOCEAN_DEPLOYMENT.md`

---

## 🎉 Ready to Deploy?

If all items in the checklist are complete, follow the detailed guide in:
**`docs/DIGITALOCEAN_DEPLOYMENT.md`**

Good luck! 🚀
