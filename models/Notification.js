const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // User who will receive the notification
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // User who triggered the notification
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Type of notification
  type: {
    type: String,
    enum: ['reaction', 'comment', 'reply', 'post_mention', 'follow', 'message', 'story', 'message_reaction', 'story_reaction', 'post_share', 'tag', 'poke', 'report_update', 'moderation_action', 'video_like', 'video_comment', 'video_tag'],
    required: true
  },
  // Related post (if applicable)
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post'
  },
  // Related story (for story notifications)
  story: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Story'
  },
  // Related video (for video notifications)
  relatedVideo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Video'
  },
  // Related conversation (for message notifications)
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation'
  },
  // Reaction type (for reaction notifications)
  // Supports both post reactions and comment reactions
  reactionType: {
    type: String,
    enum: [
      // Post reactions
      'like', 'celebrate', 'insightful', 'funny', 'mindblown', 'support',
      // Comment reactions
      'love', 'haha', 'wow', 'sad', 'angry'
    ]
  },
  // Comment content preview (for comment notifications)
  commentText: {
    type: String,
    maxlength: 100
  },
  // Message content preview (for message notifications)
  message: {
    type: String,
    maxlength: 100
  },
  // Poke type (for poke notifications)
  pokeType: {
    type: String,
    enum: ['slap', 'kiss', 'hug', 'wave']
  },
  // Related poke (for poke notifications)
  pokeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Poke'
  },
  // Related report (for report update notifications)
  relatedReport: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Report'
  },
  // Read status
  isRead: {
    type: Boolean,
    default: false
  },
  // Timestamp
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for efficient queries
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1 });

// Auto-delete old notifications after 30 days (includes index)
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // 30 days

// Static method to create a notification
notificationSchema.statics.createNotification = async function(data) {
  try {
    // Don't create notification if sender and recipient are the same
    if (data.sender.toString() === data.recipient.toString()) {
      return null;
    }

    // Check if similar notification already exists (to avoid duplicates)
    const existingNotification = await this.findOne({
      recipient: data.recipient,
      sender: data.sender,
      type: data.type,
      post: data.post,
      createdAt: { $gte: new Date(Date.now() - 60000) } // Within last minute
    });

    if (existingNotification) {
      // Update existing notification instead of creating duplicate
      existingNotification.isRead = false;
      existingNotification.createdAt = new Date();
      if (data.reactionType) existingNotification.reactionType = data.reactionType;
      if (data.commentText) existingNotification.commentText = data.commentText;
      await existingNotification.save();
      return existingNotification;
    }

    // Create new notification
    const notification = new this(data);
    await notification.save();
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

// Instance method to mark as read
notificationSchema.methods.markAsRead = async function() {
  this.isRead = true;
  return await this.save();
};

// ==================== INDEXES FOR PERFORMANCE ====================
// Primary index for fetching user notifications
notificationSchema.index({ recipient: 1, createdAt: -1 });

// Index for unread notifications (most common query)
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

// Index for notification type queries
notificationSchema.index({ recipient: 1, type: 1, createdAt: -1 });

// Index for finding notifications by sender
notificationSchema.index({ sender: 1, createdAt: -1 });

// Compound index for duplicate detection
notificationSchema.index({ recipient: 1, sender: 1, type: 1, post: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
