const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  content: {
    type: String,
    required: function() {
      // Content is required only for non-reshared posts
      return !this.isReshare;
    },
    trim: true,
    maxlength: [5000, 'Post content cannot exceed 5000 characters']
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  images: [{
    type: String,
    trim: true
  }],
  videos: [{
    type: String,
    trim: true
  }],
  mediaType: {
    type: String,
    enum: ['text', 'image', 'video', 'mixed'],
    default: 'text'
  },
  reactions: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    type: {
      type: String,
      enum: ['like', 'celebrate', 'insightful', 'funny', 'mindblown', 'support'],
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      type: String,
      required: function() {
        // Content is required only if no GIF is provided
        return !this.gif;
      },
      trim: true,
      maxlength: [1000, 'Comment cannot exceed 1000 characters']
    },
    gif: {
      type: String,
      trim: true,
      default: null
    },
    taggedUsers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    reactions: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      type: {
        type: String,
        enum: ['like', 'love', 'haha', 'wow', 'sad', 'angry'],
        required: true
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
    replies: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      mentionedUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      content: {
        type: String,
        required: true,
        trim: true,
        maxlength: [1000, 'Reply cannot exceed 1000 characters']
      },
      taggedUsers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }],
      reactions: [{
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        type: {
          type: String,
          enum: ['like', 'love', 'haha', 'wow', 'sad', 'angry'],
          required: true
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }],
      replies: [{
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        mentionedUser: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        content: {
          type: String,
          required: true,
          trim: true,
          maxlength: [1000, 'Nested reply cannot exceed 1000 characters']
        },
        taggedUsers: [{
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        }],
        createdAt: {
          type: Date,
          default: Date.now
        }
      }],
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  visibility: {
    type: String,
    enum: ['public', 'friends', 'private'],
    default: 'public'
  },
  shares: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    sharedAt: {
      type: Date,
      default: Date.now
    },
    shareType: {
      type: String,
      enum: ['feed', 'message'],
      required: true
    }
  }],
  // Fields for reshared posts
  isReshare: {
    type: Boolean,
    default: false
  },
  originalPost: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post'
  },
  reshareCaption: {
    type: String,
    trim: true,
    maxlength: [500, 'Reshare caption cannot exceed 500 characters']
  },
  // Tagged users in the post
  taggedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
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

// Indexes for better query performance
postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ createdAt: -1 });

// Pre-validate hook to ensure reshared posts have originalPost
postSchema.pre('validate', function(next) {
  if (this.isReshare && !this.originalPost) {
    return next(new Error('Reshared posts must have an originalPost reference'));
  }
  // For reshared posts, content is optional
  if (this.isReshare && (!this.content || this.content.trim() === '')) {
    this.content = ''; // Allow empty content for reshares
  }
  next();
});

// Virtual for reactions count
postSchema.virtual('reactionsCount').get(function() {
  return this.reactions ? this.reactions.length : 0;
});

// Virtual for like count (backwards compatibility)
postSchema.virtual('likesCount').get(function() {
  return this.reactions ? this.reactions.length : 0;
});

// Virtual for comment count
postSchema.virtual('commentsCount').get(function() {
  return this.comments ? this.comments.length : 0;
});

// Virtual for reactions summary
postSchema.virtual('reactionsSummary').get(function() {
  const summary = {
    like: 0,
    celebrate: 0,
    insightful: 0,
    funny: 0,
    mindblown: 0,
    support: 0,
    total: this.reactions ? this.reactions.length : 0
  };
  
  if (this.reactions) {
    this.reactions.forEach(reaction => {
      if (summary[reaction.type] !== undefined) {
        summary[reaction.type]++;
      }
    });
  }
  
  return summary;
});

// Instance method to check if user reacted to the post
postSchema.methods.getUserReaction = function(userId) {
  if (!this.reactions) return null;
  const reaction = this.reactions.find(r => r.user.toString() === userId.toString());
  return reaction ? reaction.type : null;
};

// Instance method to add or update a reaction
postSchema.methods.addReaction = function(userId, reactionType) {
  // Remove existing reaction if any
  this.reactions = this.reactions.filter(r => r.user.toString() !== userId.toString());
  
  // Add new reaction
  this.reactions.push({
    user: userId,
    type: reactionType
  });
  
  return this.save();
};

// Instance method to remove a reaction
postSchema.methods.removeReaction = function(userId) {
  this.reactions = this.reactions.filter(r => r.user.toString() !== userId.toString());
  return this.save();
};

// Instance method to add a comment
postSchema.methods.addComment = function(userId, content) {
  this.comments.push({
    user: userId,
    content: content
  });
  return this.save();
};

// ==================== INDEXES FOR PERFORMANCE ====================
// Index for fetching posts by author (most common query)
postSchema.index({ author: 1, createdAt: -1 });

// Index for visibility and author queries (feed queries)
postSchema.index({ visibility: 1, author: 1, createdAt: -1 });

// Index for searching posts by content
postSchema.index({ content: 'text' });

// Index for finding reshared posts
postSchema.index({ isReshare: 1, originalPost: 1 });

// Compound index for efficient pagination and sorting
postSchema.index({ createdAt: -1, _id: -1 });

// Index for finding posts with specific media types
postSchema.index({ mediaType: 1, createdAt: -1 });

module.exports = mongoose.model('Post', postSchema);