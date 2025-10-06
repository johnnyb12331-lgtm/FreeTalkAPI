const mongoose = require('mongoose');

const storySchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Author is required']
  },
  mediaType: {
    type: String,
    enum: ['image', 'video', 'text'],
    required: [true, 'Media type is required']
  },
  mediaUrl: {
    type: String,
    required: false // Optional now, required only for image/video
  },
  textContent: {
    type: String,
    maxlength: [500, 'Text content cannot exceed 500 characters'],
    default: ''
  },
  caption: {
    type: String,
    maxlength: [200, 'Caption cannot exceed 200 characters'],
    default: ''
  },
  backgroundColor: {
    type: String,
    default: '#000000'
  },
  duration: {
    type: Number,
    default: 5000 // milliseconds for image stories
  },
  viewers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    viewedAt: {
      type: Date,
      default: Date.now
    }
  }],
  reactions: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    emoji: {
      type: String,
      required: true,
      maxlength: 10
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  expiresAt: {
    type: Date,
    required: true,
    default: function() {
      // Stories expire after 24 hours
      return new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  }
});

// Custom validation: require either mediaUrl or textContent
storySchema.pre('validate', function(next) {
  if (this.mediaType === 'text') {
    // For text stories, textContent is required
    if (!this.textContent || this.textContent.trim() === '') {
      this.invalidate('textContent', 'Text content is required for text stories');
    }
  } else {
    // For image/video stories, mediaUrl is required
    if (!this.mediaUrl || this.mediaUrl.trim() === '') {
      this.invalidate('mediaUrl', 'Media URL is required for image/video stories');
    }
  }
  next();
});

// Index for efficient queries
storySchema.index({ author: 1, createdAt: -1 });
storySchema.index({ expiresAt: 1 });

// Virtual for viewers count
storySchema.virtual('viewersCount').get(function() {
  return this.viewers ? this.viewers.length : 0;
});

// Virtual for reactions count
storySchema.virtual('reactionsCount').get(function() {
  return this.reactions ? this.reactions.length : 0;
});

// Method to check if story is expired
storySchema.methods.isExpired = function() {
  return Date.now() > this.expiresAt;
};

// Method to check if user has viewed
storySchema.methods.hasViewed = function(userId) {
  return this.viewers.some(viewer => viewer.user.toString() === userId.toString());
};

// Method to add viewer
storySchema.methods.addViewer = function(userId) {
  if (!this.hasViewed(userId)) {
    this.viewers.push({
      user: userId,
      viewedAt: new Date()
    });
  }
};

// Method to check if user has reacted
storySchema.methods.hasReacted = function(userId) {
  return this.reactions.some(reaction => reaction.user.toString() === userId.toString());
};

// Method to add or update reaction
storySchema.methods.addReaction = function(userId, emoji) {
  // Remove existing reaction from this user if any
  this.reactions = this.reactions.filter(
    reaction => reaction.user.toString() !== userId.toString()
  );
  
  // Add new reaction
  this.reactions.push({
    user: userId,
    emoji: emoji,
    createdAt: new Date()
  });
};

// Method to remove reaction
storySchema.methods.removeReaction = function(userId) {
  this.reactions = this.reactions.filter(
    reaction => reaction.user.toString() !== userId.toString()
  );
};

// Static method to get active stories
storySchema.statics.getActiveStories = function() {
  return this.find({
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
};

// Static method to delete expired stories
storySchema.statics.deleteExpired = function() {
  return this.deleteMany({
    expiresAt: { $lte: new Date() }
  });
};

module.exports = mongoose.model('Story', storySchema);
