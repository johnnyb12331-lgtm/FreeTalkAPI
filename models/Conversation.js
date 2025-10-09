const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  // Group chat specific fields
  isGroup: {
    type: Boolean,
    default: false
  },
  groupName: {
    type: String,
    trim: true,
    maxlength: 100
  },
  groupAvatar: {
    type: String,
    default: null
  },
  groupDescription: {
    type: String,
    trim: true,
    maxlength: 500
  },
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  // Track unread counts for each participant
  unreadCount: {
    type: Map,
    of: Number,
    default: {}
  },
  // Track if conversation is archived for each participant
  archivedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Track if conversation is deleted for each participant
  deletedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

// Validate participants based on conversation type
conversationSchema.pre('validate', function(next) {
  if (this.isGroup) {
    // Group chats must have at least 2 participants (excluding creator) = 3 total
    if (this.participants.length < 3) {
      next(new Error('Group conversation must have at least 3 participants'));
    } else if (!this.groupName || this.groupName.trim().length === 0) {
      next(new Error('Group conversation must have a name'));
    } else {
      next();
    }
  } else {
    // One-on-one chats must have exactly 2 participants
    if (this.participants.length !== 2) {
      next(new Error('Direct conversation must have exactly 2 participants'));
    } else {
      next();
    }
  }
});

// Compound index for efficient participant lookups
conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageAt: -1 });

// Static method to find or create conversation between two users
conversationSchema.statics.findOrCreate = async function(user1Id, user2Id) {
  // Sort user IDs to ensure consistent ordering
  const participants = [user1Id, user2Id].sort();
  
  let conversation = await this.findOne({
    participants: { $all: participants }
  });

  if (!conversation) {
    conversation = await this.create({
      participants,
      unreadCount: {
        [user1Id]: 0,
        [user2Id]: 0
      }
    });
  }

  return conversation;
};

// Method to increment unread count for a user
conversationSchema.methods.incrementUnread = function(userId) {
  const count = this.unreadCount.get(userId.toString()) || 0;
  this.unreadCount.set(userId.toString(), count + 1);
  return this.save();
};

// Method to reset unread count for a user
conversationSchema.methods.resetUnread = function(userId) {
  this.unreadCount.set(userId.toString(), 0);
  return this.save();
};

// Method to get unread count for a user
conversationSchema.methods.getUnreadCount = function(userId) {
  return this.unreadCount.get(userId.toString()) || 0;
};

// Method to get the other participant (for one-on-one chats)
conversationSchema.methods.getOtherParticipant = function(userId) {
  return this.participants.find(p => p.toString() !== userId.toString());
};

// Method to check if user is admin
conversationSchema.methods.isAdmin = function(userId) {
  return this.admins.some(adminId => adminId.toString() === userId.toString());
};

// Method to add participant to group
conversationSchema.methods.addParticipant = function(userId) {
  if (!this.isGroup) {
    throw new Error('Cannot add participant to non-group conversation');
  }
  if (!this.participants.some(p => p.toString() === userId.toString())) {
    this.participants.push(userId);
    this.unreadCount.set(userId.toString(), 0);
  }
  return this.save();
};

// Method to remove participant from group
conversationSchema.methods.removeParticipant = function(userId) {
  if (!this.isGroup) {
    throw new Error('Cannot remove participant from non-group conversation');
  }
  this.participants = this.participants.filter(p => p.toString() !== userId.toString());
  this.admins = this.admins.filter(adminId => adminId.toString() !== userId.toString());
  this.unreadCount.delete(userId.toString());
  return this.save();
};

// Method to add admin
conversationSchema.methods.addAdmin = function(userId) {
  if (!this.isGroup) {
    throw new Error('Cannot add admin to non-group conversation');
  }
  if (!this.admins.some(adminId => adminId.toString() === userId.toString())) {
    this.admins.push(userId);
  }
  return this.save();
};

// Method to remove admin
conversationSchema.methods.removeAdmin = function(userId) {
  if (!this.isGroup) {
    throw new Error('Cannot remove admin from non-group conversation');
  }
  this.admins = this.admins.filter(adminId => adminId.toString() !== userId.toString());
  return this.save();
};

// Method to increment unread for all participants except sender
conversationSchema.methods.incrementUnreadForAll = function(senderId) {
  this.participants.forEach(participantId => {
    const participantIdStr = participantId.toString();
    if (participantIdStr !== senderId.toString()) {
      const count = this.unreadCount.get(participantIdStr) || 0;
      this.unreadCount.set(participantIdStr, count + 1);
    }
  });
  return this.save();
};

// ==================== INDEXES FOR PERFORMANCE ====================
// Primary index for finding user conversations
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

// Index for finding conversations by last message time
conversationSchema.index({ lastMessageAt: -1 });

// Index for group conversations
conversationSchema.index({ isGroup: 1, lastMessageAt: -1 });

// Index for archived conversations
conversationSchema.index({ archivedBy: 1 });

// Compound index for finding specific one-on-one conversation
conversationSchema.index({ participants: 1, isGroup: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
