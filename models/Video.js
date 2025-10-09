const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    required: true,
    maxlength: 1000
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const videoSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  videoUrl: {
    type: String,
    required: true
  },
  thumbnailUrl: {
    type: String
  },
  duration: {
    type: Number, // in seconds
    default: 0
  },
  views: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    viewedAt: {
      type: Date,
      default: Date.now
    }
  }],
  likes: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  comments: [commentSchema],
  visibility: {
    type: String,
    enum: ['public', 'followers', 'private'],
    default: 'public'
  },
  hashtags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  taggedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Audio track information for videos with music/sounds
  audioTrack: {
    url: {
      type: String,
      default: null
    },
    title: {
      type: String,
      trim: true,
      maxlength: 200
    },
    artist: {
      type: String,
      trim: true,
      maxlength: 200
    },
    source: {
      type: String,
      enum: ['user', 'pixabay', 'freemusicarchive', 'original', 'uploaded'],
      default: 'original'
    },
    license: {
      type: String,
      trim: true,
      maxlength: 500
    },
    externalId: {
      type: String, // ID from external source (Pixabay, etc.)
      trim: true
    },
    musicTrackId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MusicTrack'
    }
  },
  // Audio settings for video playback
  originalAudio: {
    type: Boolean,
    default: true // Whether original video audio is enabled
  },
  audioStartTime: {
    type: Number, // Start time of audio track in seconds
    default: 0
  },
  audioDuration: {
    type: Number, // Duration of audio to play in seconds
    default: null
  },
  audioVolume: {
    type: Number, // Volume level 0-100
    default: 100,
    min: 0,
    max: 100
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes for better query performance
videoSchema.index({ createdAt: -1 });
videoSchema.index({ author: 1, createdAt: -1 });
videoSchema.index({ hashtags: 1 });
videoSchema.index({ 'likes.user': 1 });
videoSchema.index({ 'audioTrack.musicTrackId': 1 }); // For finding videos by sound
videoSchema.index({ 'audioTrack.title': 'text', 'audioTrack.artist': 'text' }); // Text search for audio

// Virtual for view count
videoSchema.virtual('viewCount').get(function() {
  return this.views ? this.views.length : 0;
});

// Virtual for like count
videoSchema.virtual('likeCount').get(function() {
  return this.likes ? this.likes.length : 0;
});

// Virtual for comment count
videoSchema.virtual('commentCount').get(function() {
  return this.comments ? this.comments.length : 0;
});

// Ensure virtuals are included in JSON
videoSchema.set('toJSON', { virtuals: true });
videoSchema.set('toObject', { virtuals: true });

// Method to check if user has liked the video
videoSchema.methods.isLikedByUser = function(userId) {
  return this.likes.some(like => like.user.toString() === userId.toString());
};

// Method to check if user has viewed the video
videoSchema.methods.isViewedByUser = function(userId) {
  return this.views.some(view => view.user.toString() === userId.toString());
};

// Static method to get videos feed
videoSchema.statics.getFeed = async function(options = {}) {
  const {
    userId,
    page = 1,
    limit = 10,
    excludeBlockedUsers = []
  } = options;

  const skip = (page - 1) * limit;

  const query = {
    visibility: 'public',
    isDeleted: false
  };

  // Exclude blocked users
  if (excludeBlockedUsers.length > 0) {
    query.author = { $nin: excludeBlockedUsers };
  }

  const videos = await this.find(query)
    .populate('author', 'name email avatar')
    .populate('taggedUsers', 'name email avatar')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean();

  const total = await this.countDocuments(query);

  return {
    videos,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

// Static method to get user's videos
videoSchema.statics.getUserVideos = async function(userId, options = {}) {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const videos = await this.find({
    author: userId,
    isDeleted: false
  })
    .populate('author', 'name email avatar')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean();

  const total = await this.countDocuments({
    author: userId,
    isDeleted: false
  });

  return {
    videos,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

// Pre-save middleware to extract hashtags
videoSchema.pre('save', function(next) {
  if (this.description) {
    const hashtagRegex = /#[\w]+/g;
    const matches = this.description.match(hashtagRegex);
    if (matches) {
      this.hashtags = matches.map(tag => tag.substring(1).toLowerCase());
    }
  }
  next();
});

const Video = mongoose.model('Video', videoSchema);

module.exports = Video;
