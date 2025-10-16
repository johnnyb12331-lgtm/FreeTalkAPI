require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const connectDB = require('./config/db');

const app = express();

// Trust proxy - required for rate limiting behind nginx
app.set('trust proxy', true);

// Create server based on environment
let server;
const isProduction = process.env.NODE_ENV === 'production';
const useHTTPS = process.env.USE_HTTPS === 'true';

if (useHTTPS && isProduction) {
  try {
    // Load SSL certificates
    const sslOptions = {
      key: fs.readFileSync(process.env.SSL_KEY_PATH || '/etc/letsencrypt/live/freetalk.site/privkey.pem'),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH || '/etc/letsencrypt/live/freetalk.site/fullchain.pem')
    };
    server = https.createServer(sslOptions, app);
    console.log('🔒 HTTPS server initialized');
  } catch (error) {
    console.error('❌ Failed to load SSL certificates:', error.message);
    console.log('⚠️  Falling back to HTTP server');
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
  console.log('🔓 HTTP server initialized');
}

// Configure allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : isProduction 
    ? ['https://freetalk.site', 'https://www.freetalk.site']
    : ['http://localhost:3000', 'http://localhost:5000', 'http://localhost:8080'];

// Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      // In development, allow all origins
      if (!isProduction) return callback(null, true);
      
      // In production, check against allowed origins OR localhost
      const isLocalhost = origin && (
        origin.startsWith('http://localhost:') || 
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('http://[::1]:')
      );
      
      if (allowedOrigins.includes(origin) || isLocalhost) {
        callback(null, true);
      } else {
        console.warn(`⚠️  Blocked by CORS: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true
  },
  transports: ['polling', 'websocket'], // Start with polling, upgrade to websocket
  allowUpgrades: true, // Allow transport upgrades
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In development, allow all origins
    if (!isProduction) return callback(null, true);
    
    // In production, check against allowed origins OR localhost
    const isLocalhost = origin && (
      origin.startsWith('http://localhost:') || 
      origin.startsWith('http://127.0.0.1:') ||
      origin.startsWith('http://[::1]:')
    );
    
    if (allowedOrigins.includes(origin) || isLocalhost) {
      callback(null, true);
    } else {
      console.warn(`⚠️  Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files with proper headers for downloads
app.use('/uploads', (req, res, next) => {
  // Set headers to allow downloads and proper content type
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  
  // For video files, set proper content type and allow range requests
  if (req.path.match(/\.(mp4|webm|avi|mov|mpeg)$/i)) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    // Don't force download in browser, but allow it
    // res.setHeader('Content-Disposition', 'inline');
  }
  // For audio files, set proper content type and allow range requests
  if (req.path.match(/\.(mp3|m4a|aac|ogg|wav)$/i)) {
    // Basic mapping for common audio types
    if (req.path.toLowerCase().endsWith('.mp3')) {
      res.setHeader('Content-Type', 'audio/mpeg');
    } else if (req.path.toLowerCase().endsWith('.m4a')) {
      res.setHeader('Content-Type', 'audio/mp4');
    } else if (req.path.toLowerCase().endsWith('.aac')) {
      res.setHeader('Content-Type', 'audio/aac');
    } else if (req.path.toLowerCase().endsWith('.ogg')) {
      res.setHeader('Content-Type', 'audio/ogg');
    } else if (req.path.toLowerCase().endsWith('.wav')) {
      res.setHeader('Content-Type', 'audio/wav');
    }
    res.setHeader('Accept-Ranges', 'bytes');
  }
  
  next();
}, express.static('uploads', {
  // Enable directory listing in development
  index: false,
  // Set cache control
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day cache
  }
}));

// Connect to MongoDB
connectDB();

// Initialize FCM Service
const FCMService = require('./services/fcmService');
FCMService.initialize();
// Reminder service: birthdays and event reminders
const ReminderService = require('./services/reminderService');
// Memory service: On This Day reminders and memory collections
const MemoryService = require('./services/memoryService');

// Socket.IO connection handling
// Map to store userId -> Set of socketIds (to support multiple connections per user)
const userSockets = new Map();
const activeCalls = new Map(); // Map to store active calls: callId -> {callerId, calleeId, callType}

io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);

  // Handle user authentication
  // Handle ping (heartbeat) from client
  socket.on('ping', (data) => {
    // Respond with pong to confirm connection is alive
    socket.emit('pong', { timestamp: new Date().toISOString() });
    
    // Update last active time
    if (socket.userId) {
      const User = require('./models/User');
      User.findByIdAndUpdate(socket.userId, {
        lastActive: new Date()
      }).catch(err => console.error('Error updating lastActive:', err));
    }
  });

  socket.on('authenticate', async (userId) => {
    console.log(`👤 ==========================================`);
    console.log(`👤 User ${userId} authenticated with socket ${socket.id}`);
    
    // Support multiple connections per user (different devices/tabs)
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);
    
    socket.userId = userId;
    socket.join(`user:${userId}`);
    console.log(`👤 ✅ User ${userId} joined room: user:${userId}`);
    console.log(`👤 Total connections for user ${userId}: ${userSockets.get(userId).size}`);
    
    // Verify room membership
    const rooms = Array.from(socket.rooms);
    console.log(`👤 Socket ${socket.id} is in rooms:`, rooms);
    
    // Update user online status
    try {
      const User = require('./models/User');
      await User.findByIdAndUpdate(userId, {
        isOnline: true,
        lastActive: new Date()
      });
      console.log(`✅ User ${userId} set to online`);
      
      // Emit user status change to all connected clients
      io.emit('user:status-changed', {
        userId,
        isOnline: true,
        lastActive: new Date()
      });
    } catch (error) {
      console.error('❌ Error updating user online status:', error);
    }
    
    socket.emit('authenticated', { userId, socketId: socket.id });
    console.log(`👤 ✅ Authentication complete for user ${userId}`);
    console.log(`👤 ==========================================`);
  });

  // ===== WebRTC Call Signaling =====
  
  // Initiate a call
  socket.on('call:initiate', async (data) => {
    try {
      const { callId, calleeId, callType } = data;
      const callerId = socket.userId;
      
      console.log(`📞 Call initiated: ${callerId} -> ${calleeId} (${callType})`);
      
      // Check if callee is online
      const calleeSocketId = userSockets.get(calleeId);
      if (!calleeSocketId) {
        socket.emit('call:failed', { callId, reason: 'User is offline' });
        return;
      }
      
      // Check if callee is already in a call
      const isCalleeInCall = Array.from(activeCalls.values()).some(
        call => call.callerId === calleeId || call.calleeId === calleeId
      );
      
      if (isCalleeInCall) {
        socket.emit('call:busy', { callId, calleeId });
        return;
      }
      
      // Store active call
      activeCalls.set(callId, { callerId, calleeId, callType, startTime: Date.now() });
      
      // Save call to database
      const Call = require('./models/Call');
      const User = require('./models/User');
      
      const caller = await User.findById(callerId).select('name avatar');
      
      await Call.create({
        callId,
        caller: callerId,
        callee: calleeId,
        callType,
        status: 'ringing'
      });
      
      // Send incoming call notification to callee
      io.to(`user:${calleeId}`).emit('call:incoming', {
        callId,
        callerId,
        callerName: caller.name,
        callerAvatar: caller.avatar,
        callType
      });
      
      // Set timeout for call (30 seconds)
      setTimeout(async () => {
        if (activeCalls.has(callId)) {
          const call = activeCalls.get(callId);
          if (call && call.status !== 'accepted') {
            activeCalls.delete(callId);
            
            // Update call status in database
            const callDoc = await Call.findOne({ callId });
            if (callDoc && callDoc.status === 'ringing') {
              await callDoc.markAsTimeout();
            }
            
            // Notify both parties
            io.to(`user:${callerId}`).emit('call:timeout', { callId });
            io.to(`user:${calleeId}`).emit('call:timeout', { callId });
          }
        }
      }, 30000);
      
    } catch (error) {
      console.error('❌ Error initiating call:', error);
      socket.emit('call:failed', { callId: data.callId, reason: error.message });
    }
  });
  
  // Accept a call
  socket.on('call:accept', async (data) => {
    try {
      const { callId, peerId } = data;
      console.log(`✅ Call accepted: ${callId}`);
      
      const call = activeCalls.get(callId);
      if (call) {
        call.status = 'accepted';
        
        // Update call in database
        const Call = require('./models/Call');
        const callDoc = await Call.findOne({ callId });
        if (callDoc) {
          await callDoc.markAsAccepted();
        }
      }
      
      // Notify caller that call was accepted
      io.to(`user:${peerId}`).emit('call:accepted', { callId });
    } catch (error) {
      console.error('❌ Error accepting call:', error);
    }
  });
  
  // Decline a call
  socket.on('call:decline', async (data) => {
    try {
      const { callId, peerId } = data;
      console.log(`❌ Call declined: ${callId}`);
      
      activeCalls.delete(callId);
      
      // Update call in database
      const Call = require('./models/Call');
      const callDoc = await Call.findOne({ callId });
      if (callDoc) {
        await callDoc.markAsDeclined();
      }
      
      // Notify caller that call was declined
      io.to(`user:${peerId}`).emit('call:declined', { callId });
    } catch (error) {
      console.error('❌ Error declining call:', error);
    }
  });
  
  // End a call
  socket.on('call:end', async (data) => {
    try {
      const { callId, peerId } = data;
      console.log(`📴 Call ended: ${callId}`);
      
      activeCalls.delete(callId);
      
      // Update call in database
      const Call = require('./models/Call');
      const callDoc = await Call.findOne({ callId });
      if (callDoc) {
        await callDoc.markAsEnded();
      }
      
      // Notify other party that call ended
      io.to(`user:${peerId}`).emit('call:ended', { callId });
    } catch (error) {
      console.error('❌ Error ending call:', error);
    }
  });
  
  // User is busy
  socket.on('call:busy', async (data) => {
    try {
      const { callId, peerId } = data;
      console.log(`📵 User busy: ${callId}`);
      
      activeCalls.delete(callId);
      
      // Notify caller that callee is busy
      io.to(`user:${peerId}`).emit('call:busy', { callId });
    } catch (error) {
      console.error('❌ Error handling busy signal:', error);
    }
  });
  
  // WebRTC Signaling: Offer
  socket.on('call:offer', (data) => {
    const { callId, peerId, offer } = data;
    console.log(`📨 Forwarding offer for call ${callId}`);
    io.to(`user:${peerId}`).emit('call:offer', { callId, offer });
  });
  
  // WebRTC Signaling: Answer
  socket.on('call:answer', (data) => {
    const { callId, peerId, answer } = data;
    console.log(`📨 Forwarding answer for call ${callId}`);
    io.to(`user:${peerId}`).emit('call:answer', { callId, answer });
  });

  // ===== Event realtime rooms =====
  socket.on('events:subscribe', (data) => {
    const { eventId } = data || {};
    if (!eventId) return;
    socket.join(`event:${eventId}`);
    socket.emit('events:subscribed', { eventId });
  });
  socket.on('events:unsubscribe', (data) => {
    const { eventId } = data || {};
    if (!eventId) return;
    socket.leave(`event:${eventId}`);
    socket.emit('events:unsubscribed', { eventId });
  });

  // ===== Club realtime rooms =====
  socket.on('club:subscribe', (data) => {
    const { clubId } = data || {};
    if (!clubId) return;
    socket.join(`club:${clubId}`);
    socket.emit('club:subscribed', { clubId });
    console.log(`🏛️ User ${socket.userId} subscribed to club: ${clubId}`);
  });
  
  socket.on('club:unsubscribe', (data) => {
    const { clubId } = data || {};
    if (!clubId) return;
    socket.leave(`club:${clubId}`);
    socket.emit('club:unsubscribed', { clubId });
    console.log(`🏛️ User ${socket.userId} unsubscribed from club: ${clubId}`);
  });

  // Typing indicator for club discussions
  socket.on('club:typing', (data) => {
    const { clubId, userName } = data || {};
    if (!clubId) return;
    socket.to(`club:${clubId}`).emit('club:user-typing', { clubId, userId: socket.userId, userName });
  });

  socket.on('club:stop-typing', (data) => {
    const { clubId } = data || {};
    if (!clubId) return;
    socket.to(`club:${clubId}`).emit('club:user-stop-typing', { clubId, userId: socket.userId });
  });
  
  // WebRTC Signaling: ICE Candidate
  socket.on('call:ice-candidate', (data) => {
    const { callId, peerId, candidate } = data;
    console.log(`🧊 Forwarding ICE candidate for call ${callId}`);
    io.to(`user:${peerId}`).emit('call:ice-candidate', { callId, candidate });
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log('🔌 Client disconnected:', socket.id);
    if (socket.userId) {
      const userId = socket.userId;
      
      // Remove this specific socket from the user's socket set
      if (userSockets.has(userId)) {
        userSockets.get(userId).delete(socket.id);
        console.log(`👤 Removed socket ${socket.id} from user ${userId}`);
        console.log(`👤 Remaining connections for user ${userId}: ${userSockets.get(userId).size}`);
        
        // Only delete the user entry if no more connections
        if (userSockets.get(userId).size === 0) {
          userSockets.delete(userId);
          console.log(`👤 No more connections for user ${userId}, removing from map`);
          
          // End any active calls for this user
          for (const [callId, call] of activeCalls.entries()) {
            if (call.callerId === userId || call.calleeId === userId) {
              const otherUserId = call.callerId === userId ? call.calleeId : call.callerId;
              io.to(`user:${otherUserId}`).emit('call:ended', { callId, reason: 'User disconnected' });
              activeCalls.delete(callId);
              
              // Update call in database
              try {
                const Call = require('./models/Call');
                const callDoc = await Call.findOne({ callId });
                if (callDoc && callDoc.status !== 'ended') {
                  await callDoc.markAsEnded();
                }
              } catch (error) {
                console.error('❌ Error ending call on disconnect:', error);
              }
            }
          }
          
          // Update user offline status only when ALL connections are closed
          try {
            const User = require('./models/User');
            await User.findByIdAndUpdate(userId, {
              isOnline: false,
              lastActive: new Date()
            });
            console.log(`✅ User ${userId} set to offline`);
            
            // Emit user status change to all connected clients
            io.emit('user:status-changed', {
              userId,
              isOnline: false,
              lastActive: new Date()
            });
          } catch (error) {
            console.error('❌ Error updating user offline status:', error);
          }
        }
      }
    }
  });

  // ===== Memory Events =====
  
  // Request memories for today
  socket.on('memory:request', async (data) => {
    try {
      const userId = socket.userId;
      if (!userId) {
        socket.emit('memory:error', { message: 'Not authenticated' });
        return;
      }

      const Memory = require('./models/Memory');
      const memories = await Memory.getTodaysMemories(userId, {
        includeViewed: data?.includeViewed || false,
        limit: data?.limit || 20
      });

      socket.emit('memory:response', {
        count: memories.length,
        memories
      });
    } catch (error) {
      console.error('Error fetching memories:', error);
      socket.emit('memory:error', { message: 'Failed to fetch memories' });
    }
  });

  // Mark memory as viewed
  socket.on('memory:view', async (data) => {
    try {
      const userId = socket.userId;
      if (!userId) return;

      const { memoryId } = data;
      const Memory = require('./models/Memory');
      const memory = await Memory.findOne({ _id: memoryId, user: userId });

      if (memory) {
        await memory.markAsViewed();
        socket.emit('memory:viewed', { memoryId, viewed: true });
      }
    } catch (error) {
      console.error('Error marking memory as viewed:', error);
    }
  });

  // Share memory
  socket.on('memory:share', async (data) => {
    try {
      const userId = socket.userId;
      if (!userId) return;

      const { memoryId } = data;
      const Memory = require('./models/Memory');
      const memory = await Memory.findOne({ _id: memoryId, user: userId });

      if (memory) {
        await memory.markAsShared();
        socket.emit('memory:shared', { memoryId, shared: true });
      }
    } catch (error) {
      console.error('Error sharing memory:', error);
    }
  });

  // ===== Crisis Response Real-Time Handlers =====
  
  // Join a crisis response room to receive updates
  socket.on('crisis:join', async (data) => {
    try {
      const { crisisId } = data;
      socket.join(`crisis:${crisisId}`);
      console.log(`🆘 User ${socket.userId} joined crisis room: crisis:${crisisId}`);
      socket.emit('crisis:joined', { crisisId });
    } catch (error) {
      console.error('Error joining crisis room:', error);
    }
  });

  // Leave a crisis response room
  socket.on('crisis:leave', async (data) => {
    try {
      const { crisisId } = data;
      socket.leave(`crisis:${crisisId}`);
      console.log(`🆘 User ${socket.userId} left crisis room: crisis:${crisisId}`);
    } catch (error) {
      console.error('Error leaving crisis room:', error);
    }
  });

  // Send a real-time update to a crisis
  socket.on('crisis:send-update', async (data) => {
    try {
      const userId = socket.userId;
      if (!userId) return;

      const { crisisId, message } = data;
      const CrisisResponse = require('./models/CrisisResponse');
      const User = require('./models/User');
      
      const crisis = await CrisisResponse.findById(crisisId);
      if (!crisis) {
        socket.emit('crisis:error', { message: 'Crisis not found' });
        return;
      }

      // Add update to crisis
      crisis.updates.push({
        user: userId,
        message,
        timestamp: new Date()
      });
      await crisis.save();

      const user = await User.findById(userId).select('name profilePicture');

      // Broadcast update to all users in the crisis room
      io.to(`crisis:${crisisId}`).emit('crisis:new-update', {
        crisisId,
        update: {
          user: {
            _id: userId,
            name: user.name,
            profilePicture: user.profilePicture
          },
          message,
          timestamp: new Date()
        }
      });
    } catch (error) {
      console.error('Error sending crisis update:', error);
      socket.emit('crisis:error', { message: 'Failed to send update' });
    }
  });

  // Notify that someone is viewing the crisis (for awareness)
  socket.on('crisis:viewing', async (data) => {
    try {
      const { crisisId } = data;
      const User = require('./models/User');
      const user = await User.findById(socket.userId).select('name');
      
      // Broadcast to crisis room that someone is viewing
      socket.to(`crisis:${crisisId}`).emit('crisis:viewer', {
        crisisId,
        viewer: {
          _id: socket.userId,
          name: user?.name
        }
      });
    } catch (error) {
      console.error('Error broadcasting crisis viewer:', error);
    }
  });

  // Request immediate help (emergency broadcast)
  socket.on('crisis:emergency-broadcast', async (data) => {
    try {
      const userId = socket.userId;
      if (!userId) return;

      const { crisisId, message } = data;
      const CrisisResponse = require('./models/CrisisResponse');
      const User = require('./models/User');
      
      const crisis = await CrisisResponse.findById(crisisId)
        .populate('user', 'name profilePicture');
      
      if (!crisis || crisis.user._id.toString() !== userId) {
        socket.emit('crisis:error', { message: 'Unauthorized' });
        return;
      }

      // Update crisis severity to critical
      crisis.severity = 'critical';
      await crisis.save();

      // Broadcast emergency alert to all online users based on visibility
      if (crisis.visibility === 'community') {
        io.emit('crisis:emergency', {
          crisisId: crisis._id,
          type: crisis.crisisType,
          severity: 'critical',
          message: message || 'Emergency help needed!',
          user: crisis.isAnonymous ? null : {
            _id: crisis.user._id,
            name: crisis.user.name,
            profilePicture: crisis.user.profilePicture
          },
          location: crisis.location?.address
        });
      } else {
        // Broadcast to friends only
        const user = await User.findById(userId);
        const friendIds = user.friends || [];
        
        friendIds.forEach(friendId => {
          if (userSockets.has(friendId.toString())) {
            const socketIds = userSockets.get(friendId.toString());
            socketIds.forEach(socketId => {
              io.to(socketId).emit('crisis:emergency', {
                crisisId: crisis._id,
                type: crisis.crisisType,
                severity: 'critical',
                message: message || 'Emergency help needed!',
                user: crisis.isAnonymous ? null : {
                  _id: crisis.user._id,
                  name: crisis.user.name,
                  profilePicture: crisis.user.profilePicture
                },
                location: crisis.location?.address
              });
            });
          }
        });
      }

      socket.emit('crisis:emergency-sent', { crisisId });
    } catch (error) {
      console.error('Error sending emergency broadcast:', error);
      socket.emit('crisis:error', { message: 'Failed to send emergency alert' });
    }
  });
});

// Make io and userSockets available to routes
app.set('io', io);
app.set('userSockets', userSockets);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/users', require('./routes/user'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/stories', require('./routes/stories'));
app.use('/api/calls', require('./routes/calls'));
app.use('/api/pokes', require('./routes/pokes'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/music', require('./routes/music'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/iap', require('./routes/iap')); // In-App Purchase verification
app.use('/api/admin', require('./routes/admin'));
app.use('/api/events', require('./routes/events'));
app.use('/api/memories', require('./routes/memories')); // Memories and On This Day feature
app.use('/api/crisis', require('./routes/crisis')); // Crisis Response and Safety Checks
app.use('/api/clubs', require('./routes/clubs')); // Clubs feature

// Health check endpoint
app.get('/api/health', (req, res) => {
  const mongoose = require('mongoose');
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  
  res.json({ 
    status: 'ok', 
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: dbStatus,
    uptime: process.uptime()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'FreeTalk API Server',
    version: '1.0.0',
    status: 'running'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  if (isProduction) {
    console.log(`🔗 API available at https://freetalk.site`);
    console.log(`🔗 Local endpoint: http://localhost:${PORT}`);
  } else {
    console.log(`🔗 API available at http://localhost:${PORT}`);
  }

  // Start reminder service after server is listening
  try {
    const reminderSvc = new ReminderService(io);
    reminderSvc.start();
    app.set('reminderService', reminderSvc);
  } catch (e) {
    console.error('❌ Failed to start ReminderService:', e.message);
  }

  // Start memory service after server is listening
  try {
    const memorySvc = new MemoryService(io);
    memorySvc.start();
    app.set('memoryService', memorySvc);
  } catch (e) {
    console.error('❌ Failed to start MemoryService:', e.message);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Promise Rejection:', err);
  server.close(() => process.exit(1));
});
