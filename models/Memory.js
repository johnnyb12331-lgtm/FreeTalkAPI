const mongoose = require('mongoose');

const memorySchema = new mongoose.Schema({
  // User who owns this memory
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Related post that created this memory
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  // Original creation date of the post (for anniversary calculations)
  originalDate: {
    type: Date,
    required: true,
    index: true
  },
  // Year of the original post
  year: {
    type: Number,
    required: true
  },
  // Memory type
  type: {
    type: String,
    enum: ['anniversary', 'milestone', 'on_this_day'],
    default: 'on_this_day'
  },
  // Years since original post
  yearsAgo: {
    type: Number,
    default: 1
  },
  // Whether this memory has been viewed by the user
  viewed: {
    type: Boolean,
    default: false
  },
  // Whether user has shared/reshared this memory
  shared: {
    type: Boolean,
    default: false
  },
  // Custom memory collection (optional grouping)
  collection: {
    type: String,
    default: null,
    trim: true
  },
  // Tags for memory categorization
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  // Custom note added by user to this memory
  note: {
    type: String,
    maxlength: [500, 'Memory note cannot exceed 500 characters'],
    trim: true
  },
  // Notification sent for this memory
  notificationSent: {
    type: Boolean,
    default: false
  },
  // When the notification was sent
  notificationSentAt: {
    type: Date,
    default: null
  },
  // Engagement metrics
  metrics: {
    views: {
      type: Number,
      default: 0
    },
    shares: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
memorySchema.index({ user: 1, originalDate: 1 });
memorySchema.index({ user: 1, viewed: 1 });
memorySchema.index({ user: 1, type: 1 });
memorySchema.index({ user: 1, collection: 1 });
memorySchema.index({ notificationSent: 1, originalDate: 1 });

// Static method to create memories from posts
memorySchema.statics.createMemoriesFromPosts = async function(userId) {
  const Post = mongoose.model('Post');
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentDay = now.getDate();
  
  // Find posts from previous years on this date
  const oldPosts = await Post.find({
    author: userId,
    createdAt: {
      $lte: new Date(now.getFullYear() - 1, currentMonth, currentDay + 1),
      $gte: new Date(now.getFullYear() - 10, currentMonth, currentDay) // Look back 10 years
    }
  }).sort({ createdAt: -1 });
  
  const memories = [];
  for (const post of oldPosts) {
    const postDate = new Date(post.createdAt);
    
    // Check if it's the same month and day
    if (postDate.getMonth() === currentMonth && postDate.getDate() === currentDay) {
      const yearsAgo = now.getFullYear() - postDate.getFullYear();
      
      // Check if memory already exists
      const existingMemory = await this.findOne({
        user: userId,
        post: post._id,
        yearsAgo: yearsAgo
      });
      
      if (!existingMemory) {
        memories.push({
          user: userId,
          post: post._id,
          originalDate: post.createdAt,
          year: postDate.getFullYear(),
          type: 'on_this_day',
          yearsAgo: yearsAgo,
          notificationSent: false
        });
      }
    }
  }
  
  if (memories.length > 0) {
    await this.insertMany(memories);
  }
  
  return memories.length;
};

// Static method to get today's memories for a user
memorySchema.statics.getTodaysMemories = async function(userId, options = {}) {
  const { includeViewed = false, limit = 20 } = options;
  
  const query = {
    user: userId
  };
  
  if (!includeViewed) {
    query.viewed = false;
  }
  
  const memories = await this.find(query)
    .populate({
      path: 'post',
      populate: [
        { path: 'author', select: 'name profilePicture' },
        { path: 'reactions.user', select: 'name profilePicture' },
        { path: 'comments.user', select: 'name profilePicture' }
      ]
    })
    .sort({ originalDate: -1, yearsAgo: -1 })
    .limit(limit);
  
  return memories;
};

// Static method to get memory collections
memorySchema.statics.getCollections = async function(userId) {
  const collections = await this.aggregate([
    { $match: { user: mongoose.Types.ObjectId(userId), collection: { $ne: null } } },
    { $group: {
      _id: '$collection',
      count: { $sum: 1 },
      lastUpdated: { $max: '$updatedAt' }
    }},
    { $sort: { lastUpdated: -1 } }
  ]);
  
  return collections;
};

// Method to mark memory as viewed
memorySchema.methods.markAsViewed = async function() {
  if (!this.viewed) {
    this.viewed = true;
    this.metrics.views += 1;
    await this.save();
  }
};

// Method to mark memory as shared
memorySchema.methods.markAsShared = async function() {
  if (!this.shared) {
    this.shared = true;
    this.metrics.shares += 1;
    await this.save();
  }
};

const Memory = mongoose.model('Memory', memorySchema);

module.exports = Memory;
