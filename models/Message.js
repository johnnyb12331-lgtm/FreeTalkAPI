const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    // Not required for group messages
    required: false
  },
  content: {
    type: String,
    trim: true,
    maxlength: 5000
  },
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'document', 'gif', 'voice', 'shared_post', 'shared_story'],
    default: 'text'
  },
  sharedPost: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    default: null
  },
  sharedStory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Story',
    default: null
  },
  fileName: {
    type: String,
    default: null
  },
  fileSize: {
    type: Number,
    default: null
  },
  mediaUrl: {
    type: String,
    default: null
  },
  thumbnail: {
    type: String,
    default: null
  },
  gifUrl: {
    type: String,
    default: null
  },
  duration: {
    type: Number, // Duration in seconds for voice messages
    default: null
  },
  waveformData: {
    type: [Number], // Array of amplitude values for waveform visualization
    default: null
  },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date,
    default: null
  },
  // For group messages, track who has read the message
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  reactions: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    emoji: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// ==================== INDEXES FOR PERFORMANCE ====================
// Primary index for fetching messages in a conversation
messageSchema.index({ conversation: 1, createdAt: -1 });

// Index for sender-recipient queries
messageSchema.index({ sender: 1, recipient: 1, createdAt: -1 });

// Index for unread messages
messageSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

// Text index for search functionality
messageSchema.index({ content: 'text', fileName: 'text' });

// Index for message type queries (finding images, videos, etc.)
messageSchema.index({ conversation: 1, type: 1, createdAt: -1 });

// Index for reply threads
messageSchema.index({ replyTo: 1 });

// Virtual for message age
messageSchema.virtual('age').get(function() {
  return Date.now() - this.createdAt;
});

// Method to soft delete for a user
messageSchema.methods.deleteForUser = function(userId) {
  if (!this.deletedBy.includes(userId)) {
    this.deletedBy.push(userId);
  }
  // If both users deleted, mark as fully deleted
  if (this.deletedBy.length >= 2) {
    this.isDeleted = true;
  }
  return this.save();
};

module.exports = mongoose.model('Message', messageSchema);
