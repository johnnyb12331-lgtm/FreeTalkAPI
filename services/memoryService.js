const Memory = require('../models/Memory');
const Post = require('../models/Post');
const Notification = require('../models/Notification');
const User = require('../models/User');
const FCM = require('./fcmService');

class MemoryService {
  constructor(io) {
    this.io = io;
    this._interval = null;
    this._dailyCheckInterval = null;
  }

  start() {
    // Check for memories at app startup
    console.log('🎂 MemoryService starting...');
    this.runSafely();
    
    // Run every hour to check for new memories
    this._interval = setInterval(() => this.runSafely(), 60 * 60 * 1000);
    
    // Run daily check at midnight UTC
    this.scheduleDailyCheck();
    
    console.log('✅ MemoryService started - checking hourly and daily at midnight UTC');
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    if (this._dailyCheckInterval) {
      clearInterval(this._dailyCheckInterval);
      this._dailyCheckInterval = null;
    }
    console.log('🛑 MemoryService stopped');
  }

  scheduleDailyCheck() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    
    const timeUntilMidnight = tomorrow - now;
    
    // Schedule first check at midnight
    setTimeout(() => {
      this.runDailyCheck();
      // Then run every 24 hours
      this._dailyCheckInterval = setInterval(() => this.runDailyCheck(), 24 * 60 * 60 * 1000);
    }, timeUntilMidnight);
    
    console.log(`⏰ Daily memory check scheduled for ${tomorrow.toISOString()}`);
  }

  async runSafely() {
    try {
      await this.checkAndNotifyMemories();
    } catch (e) {
      console.error('❌ MemoryService error:', e);
    }
  }

  async runDailyCheck() {
    try {
      console.log('🌅 Running daily memory generation check...');
      await this.generateDailyMemories();
      await this.checkAndNotifyMemories();
    } catch (e) {
      console.error('❌ Daily memory check error:', e);
    }
  }

  /**
   * Generate memories for all active users
   */
  async generateDailyMemories() {
    try {
      console.log('🎬 Generating daily memories for all users...');
      
      // Get all users who have posts
      const users = await User.find({
        // Only check active users (logged in within last 30 days)
        lastActive: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }).select('_id');
      
      let totalMemoriesCreated = 0;
      
      for (const user of users) {
        try {
          const count = await Memory.createMemoriesFromPosts(user._id);
          totalMemoriesCreated += count;
        } catch (err) {
          console.error(`Error generating memories for user ${user._id}:`, err.message);
        }
      }
      
      console.log(`✅ Generated ${totalMemoriesCreated} new memories for ${users.length} users`);
      return totalMemoriesCreated;
    } catch (error) {
      console.error('❌ Error generating daily memories:', error);
      throw error;
    }
  }

  /**
   * Check for memories that need notifications and send them
   */
  async checkAndNotifyMemories() {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      
      // Find memories from today that haven't been notified yet
      const pendingMemories = await Memory.find({
        notificationSent: false,
        createdAt: {
          $gte: todayStart,
          $lte: todayEnd
        }
      }).populate('user', 'name settings fcmToken')
        .populate('post', 'content images videos createdAt');
      
      console.log(`📬 Found ${pendingMemories.length} pending memory notifications`);
      
      for (const memory of pendingMemories) {
        try {
          await this.sendMemoryNotification(memory);
        } catch (err) {
          console.error(`Error sending memory notification for ${memory._id}:`, err.message);
        }
      }
      
      return pendingMemories.length;
    } catch (error) {
      console.error('❌ Error checking memory notifications:', error);
      throw error;
    }
  }

  /**
   * Send notification for a specific memory
   */
  async sendMemoryNotification(memory) {
    try {
      const user = memory.user;
      const post = memory.post;
      
      if (!user || !post) {
        console.warn(`⚠️ Invalid memory data for ${memory._id}`);
        return;
      }
      
      // Check if user has memory notifications enabled
      if (user.settings && user.settings.notifyMemories === false) {
        console.log(`⏭️ Memory notifications disabled for user ${user._id}`);
        memory.notificationSent = true;
        memory.notificationSentAt = new Date();
        await memory.save();
        return;
      }
      
      const yearsText = memory.yearsAgo === 1 ? '1 year' : `${memory.yearsAgo} years`;
      const title = '📅 Memory from today';
      
      // Create preview of post content
      let preview = '';
      if (post.content) {
        preview = post.content.substring(0, 100);
        if (post.content.length > 100) preview += '...';
      } else if (post.images && post.images.length > 0) {
        preview = '📸 Photo memory';
      } else if (post.videos && post.videos.length > 0) {
        preview = '🎥 Video memory';
      }
      
      const body = `${yearsText} ago: ${preview}`;
      
      // Create notification in database
      await Notification.create({
        recipient: user._id,
        sender: user._id, // Self-notification
        type: 'memory_reminder',
        relatedMemory: memory._id,
        post: post._id,
        message: body,
        isRead: false
      });
      
      // Send real-time notification via Socket.IO
      this.io.to(`user:${user._id.toString()}`).emit('memory:notification', {
        memoryId: memory._id.toString(),
        postId: post._id.toString(),
        yearsAgo: memory.yearsAgo,
        originalDate: memory.originalDate,
        preview: preview,
        type: memory.type
      });
      
      // Send push notification via FCM
      await FCM.sendNotificationToUser(
        user._id,
        title,
        body,
        {
          type: 'memory',
          memoryId: memory._id.toString(),
          postId: post._id.toString(),
          yearsAgo: memory.yearsAgo.toString()
        }
      );
      
      // Mark notification as sent
      memory.notificationSent = true;
      memory.notificationSentAt = new Date();
      await memory.save();
      
      console.log(`✅ Memory notification sent to user ${user._id} for memory ${memory._id}`);
    } catch (error) {
      console.error('❌ Error sending memory notification:', error);
      throw error;
    }
  }

  /**
   * Get memories for a specific user
   */
  async getUserMemories(userId, options = {}) {
    try {
      const memories = await Memory.getTodaysMemories(userId, options);
      return memories;
    } catch (error) {
      console.error('❌ Error getting user memories:', error);
      throw error;
    }
  }

  /**
   * Get memory collections for a user
   */
  async getUserCollections(userId) {
    try {
      const collections = await Memory.getCollections(userId);
      return collections;
    } catch (error) {
      console.error('❌ Error getting user collections:', error);
      throw error;
    }
  }

  /**
   * Manually trigger memory generation for a user
   */
  async generateMemoriesForUser(userId) {
    try {
      const count = await Memory.createMemoriesFromPosts(userId);
      
      if (count > 0) {
        // Get the newly created memories
        const memories = await Memory.getTodaysMemories(userId, { includeViewed: false });
        
        // Send real-time update
        this.io.to(`user:${userId.toString()}`).emit('memories:updated', {
          count: memories.length,
          memories: memories.map(m => ({
            id: m._id,
            yearsAgo: m.yearsAgo,
            originalDate: m.originalDate
          }))
        });
      }
      
      return count;
    } catch (error) {
      console.error('❌ Error generating user memories:', error);
      throw error;
    }
  }

  /**
   * Send real-time update when user interacts with memory
   */
  async notifyMemoryInteraction(userId, memoryId, action) {
    try {
      this.io.to(`user:${userId.toString()}`).emit('memory:interaction', {
        memoryId: memoryId.toString(),
        action: action, // 'viewed', 'shared', 'saved'
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Error notifying memory interaction:', error);
    }
  }
}

module.exports = MemoryService;
