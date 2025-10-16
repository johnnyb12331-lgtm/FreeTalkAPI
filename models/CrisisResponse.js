const mongoose = require('mongoose');

const crisisResponseSchema = new mongoose.Schema({
  // User who created the crisis response request
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Type of crisis
  crisisType: {
    type: String,
    enum: [
      'mental_health',
      'medical_emergency',
      'safety_threat',
      'domestic_violence',
      'substance_abuse',
      'suicide_prevention',
      'other'
    ],
    required: true
  },
  // Severity level
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
    required: true
  },
  // Crisis description
  description: {
    type: String,
    required: true,
    maxlength: 1000
  },
  // Location information (optional)
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: undefined
    },
    address: {
      type: String,
      maxlength: 500
    }
  },
  // Contact information
  contactPhone: {
    type: String,
    maxlength: 20
  },
  // Status of the crisis response
  status: {
    type: String,
    enum: ['active', 'in_progress', 'resolved', 'closed'],
    default: 'active',
    required: true
  },
  // Privacy settings
  isAnonymous: {
    type: Boolean,
    default: false
  },
  // Visibility - who can see this crisis alert
  visibility: {
    type: String,
    enum: ['friends', 'community', 'emergency_contacts', 'private'],
    default: 'friends'
  },
  // Emergency contacts notified
  emergencyContactsNotified: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Community helpers who responded
  helpers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['offered', 'accepted', 'helping', 'completed'],
      default: 'offered'
    },
    message: {
      type: String,
      maxlength: 500
    },
    respondedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Safety check responses
  safetyChecks: [{
    checkedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['safe', 'needs_help', 'emergency'],
      required: true
    },
    message: {
      type: String,
      maxlength: 500
    },
    checkedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Updates and timeline
  updates: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    message: {
      type: String,
      required: true,
      maxlength: 500
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  // Resources provided
  resourcesProvided: [{
    type: {
      type: String,
      enum: ['hotline', 'counseling', 'shelter', 'medical', 'legal', 'financial', 'other']
    },
    name: String,
    contact: String,
    description: String,
    providedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    providedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Professional help contacted
  professionalHelpContacted: {
    type: Boolean,
    default: false
  },
  professionalHelpDetails: {
    organization: String,
    contactedAt: Date,
    followUpRequired: Boolean
  },
  // Resolution details
  resolution: {
    message: String,
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    resolvedAt: Date
  },
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  // Auto-close after a certain time (if not updated)
  expiresAt: {
    type: Date,
    default: function() {
      // Active crises expire after 24 hours if not updated
      return new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
  }
});

// Indexes for efficient queries
crisisResponseSchema.index({ user: 1, status: 1 });
crisisResponseSchema.index({ status: 1, createdAt: -1 });
crisisResponseSchema.index({ severity: 1, status: 1 });
crisisResponseSchema.index({ 'location.coordinates': '2dsphere' });
crisisResponseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Update the updatedAt timestamp on save
crisisResponseSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for getting the number of helpers
crisisResponseSchema.virtual('helperCount').get(function() {
  return this.helpers ? this.helpers.length : 0;
});

// Virtual for getting active helpers
crisisResponseSchema.virtual('activeHelpers').get(function() {
  return this.helpers ? this.helpers.filter(h => h.status === 'helping' || h.status === 'accepted') : [];
});

module.exports = mongoose.model('CrisisResponse', crisisResponseSchema);
