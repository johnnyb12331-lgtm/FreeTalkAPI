module.exports = {
  apps: [{
    name: 'freetalk-api',
    script: './server.js',
    instances: 'max', // Use all CPU cores
    exec_mode: 'cluster',
    
    // Environment variables
    env: {
      NODE_ENV: 'development',
      PORT: 5000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    
    // Logging
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    
    // Auto restart settings
    watch: false, // Set to true in development if you want auto-reload
    ignore_watch: ['node_modules', 'uploads', 'logs'],
    
    // Advanced features
    max_memory_restart: '1G', // Restart if memory exceeds 1GB
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    
    // Graceful shutdown
    kill_timeout: 5000,
    listen_timeout: 3000,
    
    // Startup settings
    wait_ready: true,
    
    // Additional settings
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
