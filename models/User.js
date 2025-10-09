const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters long'],
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/,
      'Please provide a valid email address'
    ]
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters long'],
    select: false // Don't include password in queries by default
  },
  avatar: {
    type: String,
    default: null
  },
  feedBannerPhoto: {
    type: String,
    default: null
  },
  bio: {
    type: String,
    maxlength: [500, 'Bio cannot exceed 500 characters'],
    default: ''
  },
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  savedPosts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post'
  }],
  settings: {
    notificationsEnabled: {
      type: Boolean,
      default: true
    },
    pushNotificationsEnabled: {
      type: Boolean,
      default: true
    },
    emailNotificationsEnabled: {
      type: Boolean,
      default: false
    },
    privateAccount: {
      type: Boolean,
      default: false
    },
    showOnlineStatus: {
      type: Boolean,
      default: true
    },
    theme: {
      type: String,
      enum: ['system', 'light', 'dark'],
      default: 'system'
    }
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  verificationMethod: {
    type: String,
    enum: ['free', 'manual', 'id_verification'],
    default: null
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  // Moderation fields
  isSuspended: {
    type: Boolean,
    default: false
  },
  suspensionReason: {
    type: String,
    default: null
  },
  suspendedAt: {
    type: Date,
    default: null
  },
  suspendedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  bannedAt: {
    type: Date,
    default: null
  },
  lastLogin: {
    type: Date,
    default: null
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  refreshToken: {
    type: String,
    select: false
  },
  // Premium subscription fields
  isPremium: {
    type: Boolean,
    default: false
  },
  premiumFeatures: [{
    type: String,
    enum: [
      // Premium-exclusive features
      'profile_visitors',
      'ad_free', 
      'custom_themes',
      'unlimited_storage',
      'advanced_analytics',
      'priority_support',
      'early_access',
      'custom_badge_color',
      'increased_upload_limit',
      'video_downloads',
      'read_receipts_control',
      'ghost_mode',
      // Legacy (being phased out)
      'verified_badge'
    ]
  }],
  premiumExpiresAt: {
    type: Date,
    default: null
  },
  premiumPurchaseDate: {
    type: Date,
    default: null
  },
  premiumTier: {
    type: String,
    enum: ['basic', 'plus', 'pro'],
    default: null
  },
  stripeCustomerId: {
    type: String,
    default: null
  },
  paymentHistory: [{
    amount: Number,
    currency: { type: String, default: 'usd' },
    feature: String,
    transactionId: String,
    paymentMethod: String,
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    purchasedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true, // Adds createdAt and updatedAt fields
  toJSON: {
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.refreshToken;
      delete ret.__v;
      return ret;
    }
  }
});

// Note: `unique: true` on email already creates an index

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();

  try {
    // Hash password with cost of 12
    const saltRounds = 12;
    this.password = await bcrypt.hash(this.password, saltRounds);
    next();
  } catch (error) {
    next(error);
  }
});

// Instance method to check password
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('Password comparison failed');
  }
};

// Instance method to get public profile
userSchema.methods.getPublicProfile = function() {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.refreshToken;
  return userObject;
};

// Static method to find user by email
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

// ==================== INDEXES FOR PERFORMANCE ====================
// Email index (unique) - already set in schema, but explicitly defined here
userSchema.index({ email: 1 }, { unique: true });

// Index for searching users by name
userSchema.index({ name: 'text' });

// Index for premium users (for filtering/analytics)
userSchema.index({ isPremium: 1, premiumExpiresAt: 1 });

// Index for admin users
userSchema.index({ isAdmin: 1 });

// Index for banned/suspended users
userSchema.index({ isBanned: 1, isSuspended: 1 });

// Index for last active queries (for online status)
userSchema.index({ lastActive: -1 });

// Compound index for followers/following queries
userSchema.index({ followers: 1 });
userSchema.index({ following: 1 });

// Index for account creation date
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);