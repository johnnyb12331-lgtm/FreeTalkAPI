const mongoose = require('mongoose');

const musicTrackSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
    index: true
  },
  artist: {
    type: String,
    trim: true,
    maxlength: 200,
    default: 'Unknown Artist'
  },
  url: {
    type: String,
    required: true
  },
  duration: {
    type: Number, // Duration in seconds
    required: true,
    min: 1,
    max: 300 // Max 5 minutes for sound tracks
  },
  category: {
    type: String,
    enum: [
      'trending',
      'pop',
      'hip-hop',
      'rock',
      'electronic',
      'classical',
      'jazz',
      'country',
      'r&b',
      'indie',
      'ambient',
      'sound-effects',
      'voiceover',
      'other'
    ],
    default: 'other'
  },
  source: {
    type: String,
    enum: ['user', 'pixabay', 'freemusicarchive', 'uploaded'],
    required: true,
    index: true
  },
  // License information
  license: {
    type: String,
    trim: true,
    maxlength: 500,
    default: 'User-generated content'
  },
  attribution: {
    type: String,
    trim: true,
    maxlength: 500
  },
  licenseUrl: {
    type: String,
    trim: true
  },
  // For external sources
  externalId: {
    type: String,
    trim: true,
    index: true
  },
  externalUrl: {
    type: String,
    trim: true
  },
  // For user-uploaded sounds
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  // Usage tracking
  usageCount: {
    type: Number,
    default: 0,
    min: 0
  },
  // Popularity metrics
  isPopular: {
    type: Boolean,
    default: false,
    index: true
  },
  isTrending: {
    type: Boolean,
    default: false,
    index: true
  },
  // Moderation
  isApproved: {
    type: Boolean,
    default: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  // Metadata
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  // Audio file metadata
  fileSize: {
    type: Number // in bytes
  },
  format: {
    type: String,
    enum: ['mp3', 'wav', 'ogg', 'aac', 'm4a'],
    default: 'mp3'
  },
  bitrate: {
    type: Number // in kbps
  },
  // Waveform data for visualization (optional)
  waveformData: {
    type: String // JSON string of waveform peaks
  }
}, {
  timestamps: true
});

// Indexes for better query performance
musicTrackSchema.index({ title: 'text', artist: 'text', tags: 'text' });
musicTrackSchema.index({ createdAt: -1 });
musicTrackSchema.index({ usageCount: -1 });
musicTrackSchema.index({ category: 1, isPopular: 1 });
musicTrackSchema.index({ uploadedBy: 1, createdAt: -1 });

// Virtual for display name
musicTrackSchema.virtual('displayName').get(function() {
  return this.artist && this.artist !== 'Unknown Artist' 
    ? `${this.title} - ${this.artist}` 
    : this.title;
});

// Ensure virtuals are included in JSON
musicTrackSchema.set('toJSON', { virtuals: true });
musicTrackSchema.set('toObject', { virtuals: true });

// Method to increment usage count
musicTrackSchema.methods.incrementUsage = async function() {
  this.usageCount += 1;
  
  // Mark as trending if usage count is high
  if (this.usageCount >= 100) {
    this.isTrending = true;
  }
  
  // Mark as popular if usage count is moderate
  if (this.usageCount >= 50) {
    this.isPopular = true;
  }
  
  return await this.save();
};

// Static method to get trending sounds
musicTrackSchema.statics.getTrending = async function(options = {}) {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const tracks = await this.find({
    isTrending: true,
    isApproved: true,
    isDeleted: false
  })
    .populate('uploadedBy', 'name avatar')
    .sort({ usageCount: -1, createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean();

  const total = await this.countDocuments({
    isTrending: true,
    isApproved: true,
    isDeleted: false
  });

  return {
    tracks,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

// Static method to get popular sounds
musicTrackSchema.statics.getPopular = async function(options = {}) {
  const { page = 1, limit = 20, category = null } = options;
  const skip = (page - 1) * limit;

  const query = {
    isPopular: true,
    isApproved: true,
    isDeleted: false
  };

  if (category) {
    query.category = category;
  }

  const tracks = await this.find(query)
    .populate('uploadedBy', 'name avatar')
    .sort({ usageCount: -1, createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean();

  const total = await this.countDocuments(query);

  return {
    tracks,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

// Static method to get user's uploaded sounds
musicTrackSchema.statics.getUserSounds = async function(userId, options = {}) {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const tracks = await this.find({
    uploadedBy: userId,
    isDeleted: false
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean();

  const total = await this.countDocuments({
    uploadedBy: userId,
    isDeleted: false
  });

  return {
    tracks,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

// Static method to search sounds
musicTrackSchema.statics.searchSounds = async function(query, options = {}) {
  const { page = 1, limit = 20, category = null } = options;
  const skip = (page - 1) * limit;

  const searchQuery = {
    $text: { $search: query },
    isApproved: true,
    isDeleted: false
  };

  if (category) {
    searchQuery.category = category;
  }

  const tracks = await this.find(searchQuery, { score: { $meta: 'textScore' } })
    .populate('uploadedBy', 'name avatar')
    .sort({ score: { $meta: 'textScore' }, usageCount: -1 })
    .limit(limit)
    .skip(skip)
    .lean();

  const total = await this.countDocuments(searchQuery);

  return {
    tracks,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

const MusicTrack = mongoose.model('MusicTrack', musicTrackSchema);

module.exports = MusicTrack;
