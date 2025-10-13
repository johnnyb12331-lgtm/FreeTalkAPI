# Fix 404 Error for Avatar/Media Uploads

## The Problem
The Flutter app is requesting avatar images from:
- `https://freetalk.site/api/uploads/avatar-xxx.jpg`

But the Node.js server serves uploads from:
- `http://localhost:5000/uploads/avatar-xxx.jpg`

The nginx configuration needs to proxy `/api/uploads/` requests to the backend.

## The Solution
Add an uploads proxy configuration to nginx **BEFORE** the general `/api/` location block.

## Steps:

### 1. SSH into your server
```bash
ssh root@167.71.97.187
```

### 2. Edit nginx configuration
```bash
nano /etc/nginx/sites-available/freetalk.site
```

### 3. Add this BEFORE the `location /api/` block:

```nginx
    # Uploads Proxy - Forward uploads requests to Node.js backend
    # This MUST come before the /api/ location block to take precedence
    location /api/uploads/ {
        # Rewrite /api/uploads/ to /uploads/ before proxying
        rewrite ^/api/uploads/(.*)$ /uploads/$1 break;
        
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Enable caching for better performance
        proxy_cache_valid 200 1d;
        proxy_cache_bypass $http_cache_control;
        add_header X-Proxy-Cache $upstream_cache_status;
        
        # CORS headers for media files
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods 'GET, OPTIONS' always;
        add_header Cross-Origin-Resource-Policy cross-origin always;
    }
```

### 4. Your config should look like this (in order):

```nginx
server {
    server_name freetalk.site www.freetalk.site;

    root /var/www/html;
    index index.html;

    # Uploads Proxy - MUST come before /api/ block
    location /api/uploads/ {
        rewrite ^/api/uploads/(.*)$ /uploads/$1 break;
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_valid 200 1d;
        proxy_cache_bypass $http_cache_control;
        add_header X-Proxy-Cache $upstream_cache_status;
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods 'GET, OPTIONS' always;
        add_header Cross-Origin-Resource-Policy cross-origin always;
    }

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

### 5. Test nginx configuration
```bash
nginx -t
```

### 6. Reload nginx
```bash
systemctl reload nginx
```

### 7. Verify the fix
Open your browser and test:
- https://freetalk.site/api/uploads/avatar-1760355907923-776647791.jpg

You should see the image instead of a 404 error.

## Alternative Solution (if you want to avoid the rewrite)

You could also modify the Node.js server to serve uploads at both `/uploads/` AND `/api/uploads/` paths, but the nginx solution above is cleaner and doesn't require code changes.

## Why This Order Matters

Nginx processes location blocks based on specificity:
1. Exact matches (`location = /path`)
2. Longest prefix matches first
3. Regular expressions in order

By placing `/api/uploads/` BEFORE `/api/`, nginx will:
- Match `/api/uploads/` first for uploads
- Fall through to `/api/` for other API requests

This ensures uploads are handled correctly while keeping the general API proxy intact.
