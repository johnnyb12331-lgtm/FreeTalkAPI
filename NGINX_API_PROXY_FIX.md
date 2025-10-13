# Fix 404 Error - Configure Nginx API Proxy

## The Problem
Your frontend (https://freetalk.site) is trying to access the API at https://freetalk.site/api/auth/forgot-password
but nginx doesn't know to proxy those requests to your Node.js server on port 5000.

## The Solution
Add an API proxy configuration to nginx.

## Steps:

### 1. SSH into your server
```bash
ssh root@167.71.97.187
```

### 2. Edit nginx configuration
```bash
nano /etc/nginx/sites-available/freetalk.site
```

### 3. Find the `location /` block and add this BEFORE it:

```nginx
    # API Proxy - Forward API requests to Node.js backend
    location /api/ {
        proxy_pass http://localhost:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Socket.IO proxy for real-time features
    location /socket.io/ {
        proxy_pass http://localhost:5000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

### 4. Your config should look something like this:

```nginx
server {
    server_name freetalk.site www.freetalk.site;

    root /var/www/html;
    index index.html;

    # API Proxy - Forward API requests to Node.js backend
    location /api/ {
        proxy_pass http://localhost:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Socket.IO proxy
    location /socket.io/ {
        proxy_pass http://localhost:5000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Serve Flutter web app
    location / {
        try_files $uri $uri/ /index.html;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/freetalk.site/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/freetalk.site/privkey.pem;
}

server {
    if ($host = www.freetalk.site) {
        return 301 https://$host$request_uri;
    }

    if ($host = freetalk.site) {
        return 301 https://$host$request_uri;
    }

    listen 80;
    server_name freetalk.site www.freetalk.site;
    return 404;
}
```

### 5. Save and exit
Press `Ctrl+X`, then `Y`, then `Enter`

### 6. Test the configuration
```bash
nginx -t
```

You should see:
```
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### 7. Reload nginx
```bash
systemctl reload nginx
```

### 8. Test the API
```bash
curl -X POST https://freetalk.site/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"johnnyb12331@gmail.com"}'
```

You should see:
```json
{"success":true,"message":"Password reset link has been sent to your email address."}
```

### 9. Test from your browser
Go to https://freetalk.site, click "Forgot Password", and try it!

## ✅ Done!
Your API is now accessible through nginx proxy at https://freetalk.site/api/
