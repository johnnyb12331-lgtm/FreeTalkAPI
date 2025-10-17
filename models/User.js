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
    required: false, // Password is optional - users can use PIN-only authentication
    minlength: [8, 'Password must be at least 8 characters long'],
    select: false // Don't include password in queries by default
  },
  pinCode: {
    type: String,
    required: function() {
      // PIN is required unless user is signing in with social login
      return !this.appleId && !this.googleId && !this.facebookId;
    },
    select: false, // Don't include PIN in queries by default
    validate: {
      validator: function(v) {
        // Skip validation if the PIN is already hashed (starts with $2a$ or $2b$ - bcrypt hash prefix)
        if (v && (v.startsWith('$2a$') || v.startsWith('$2b$'))) {
          return true; // Already hashed, skip validation
        }
        
        // Convert to string and trim for validation
        const pinStr = v ? v.toString().trim() : '';
        
        // For social login users, PIN is optional
        if (this.appleId || this.googleId || this.facebookId) {
          return !pinStr || /^\d{4}$/.test(pinStr); // Optional but must be valid if provided
        }
        
        // For regular users, PIN must be exactly 4 digits
        return pinStr && pinStr.length === 4 && /^\d{4}$/.test(pinStr);
      },
      message: 'PIN code must be exactly 4 digits'
    }
  },
  securityQuestion: {
    type: String,
    required: function() {
      // Security question is required for non-social login users
      return !this.appleId && !this.googleId && !this.facebookId;
    },
    enum: [
      "What is your mother's maiden name?",
      "What was the name of your first pet?",
      "What city were you born in?",
      "What is your favorite book?",
      "What was your childhood nickname?",
      "What is the name of your favorite teacher?",
      "What street did you grow up on?",
      "What is your favorite movie?"
    ]
  },
  securityAnswer: {
    type: String,
    required: function() {
      // Security answer is required for non-social login users
      return !this.appleId && !this.googleId && !this.facebookId;
    },
    select: false, // Don't include security answer in queries by default
    minlength: [2, 'Security answer must be at least 2 characters long'],
    maxlength: [100, 'Security answer cannot exceed 100 characters']
  },
  // Social login IDs (for Sign in with Apple, Google, Facebook)
  appleId: {
    type: String,
    unique: true,
    sparse: true, // Allow null values while enforcing uniqueness
    index: true
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  facebookId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
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
    },
    eventRemindersEnabled: {
      type: Boolean,
      default: true
    },
    notifyMemories: {
      type: Boolean,
      default: true
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
  isBot: {
    type: Boolean,
    default: false
  },
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
  suspensionEndDate: {
    type: Date,
    default: null
  },
  suspensionDuration: {
    type: Number, // Duration in days
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
  fcmToken: {
    type: String,
    default: null
  },
  // Birthday and profile dates
  birthday: {
    type: Date,
    default: null
  },
  showBirthdayToFriendsOnly: {
    type: Boolean,
    default: true
  },
  refreshToken: {
    type: String,
    select: false
  },
  // Password reset fields
  resetPasswordToken: {
    type: String,
    select: false
  },
  resetPasswordExpires: {
    type: Date,
    select: false
  },
  // Achievement system
  achievementPoints: {
    type: Number,
    default: 0
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
      delete ret.pinCode;
      delete ret.securityAnswer;
      delete ret.refreshToken;
      delete ret.__v;
      return ret;
    }
  }
});

// Note: `unique: true` on email already creates an index

// Pre-save middleware to hash password, PIN code, and security answer
userSchema.pre('save', async function(next) {
  try {
    const saltRounds = 12;
    
    // Hash password if modified and exists
    if (this.isModified('password') && this.password) {
      this.password = await bcrypt.hash(this.password, saltRounds);
    }
    
    // Hash PIN code if modified and exists
    if (this.isModified('pinCode') && this.pinCode) {
      // Trim and ensure it's a string before hashing
      this.pinCode = this.pinCode.toString().trim();
      
      // Only hash if it's not already hashed (doesn't start with bcrypt prefix)
      if (!this.pinCode.startsWith('$2a$') && !this.pinCode.startsWith('$2b$')) {
        console.log('🔐 Hashing PIN code before save. Length:', this.pinCode.length);
        this.pinCode = await bcrypt.hash(this.pinCode, saltRounds);
      }
    }
    
    // Hash security answer if modified and exists
    if (this.isModified('securityAnswer') && this.securityAnswer) {
      // Normalize: trim and convert to lowercase for consistent comparison
      this.securityAnswer = this.securityAnswer.trim().toLowerCase();
      
      // Only hash if it's not already hashed
      if (!this.securityAnswer.startsWith('$2a$') && !this.securityAnswer.startsWith('$2b$')) {
        console.log('🔐 Hashing security answer before save');
        this.securityAnswer = await bcrypt.hash(this.securityAnswer, saltRounds);
      }
    }
    
    next();
  } catch (error) {
    console.error('❌ Pre-save hook error:', error);
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

// Instance method to check PIN code
userSchema.methods.comparePinCode = async function(candidatePinCode) {
  try {
    return await bcrypt.compare(candidatePinCode, this.pinCode);
  } catch (error) {
    throw new Error('PIN code comparison failed');
  }
};

// Instance method to check security answer
userSchema.methods.compareSecurityAnswer = async function(candidateAnswer) {
  try {
    // Normalize the candidate answer (trim and lowercase) before comparison
    const normalizedAnswer = candidateAnswer.trim().toLowerCase();
    return await bcrypt.compare(normalizedAnswer, this.securityAnswer);
  } catch (error) {
    throw new Error('Security answer comparison failed');
  }
};

// Instance method to get public profile
userSchema.methods.getPublicProfile = function() {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.pinCode;
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