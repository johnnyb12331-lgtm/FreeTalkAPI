const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  // What's being reported
  reportType: {
    type: String,
    enum: ['user', 'post'],
    required: true
  },
  
  // Who is reporting
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // What's being reported (either user or post)
  reportedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      return this.reportType === 'user';
    }
  },
  
  reportedPost: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: function() {
      return this.reportType === 'post';
    }
  },
  
  // Report details
  reason: {
    type: String,
    required: true,
    enum: [
      'spam',
      'harassment',
      'hate_speech',
      'violence',
      'misinformation',
      'inappropriate',
      'inappropriate_content',
      'fake_account',
      'impersonation',
      'other'
    ]
  },
  
  details: {
    type: String,
    maxlength: 500,
    trim: true
  },
  
  // Report status
  status: {
    type: String,
    enum: ['pending', 'reviewing', 'resolved', 'dismissed'],
    default: 'pending'
  },
  
  // Admin notes and actions
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  reviewedAt: {
    type: Date
  },
  
  adminNotes: {
    type: String,
    maxlength: 1000
  },
  
  actionTaken: {
    type: String,
    enum: ['none', 'warning', 'content_removed', 'user_suspended', 'user_banned'],
    default: 'none'
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
reportSchema.index({ reporter: 1, createdAt: -1 });
reportSchema.index({ reportedUser: 1, createdAt: -1 });
reportSchema.index({ reportedPost: 1, createdAt: -1 });
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ reportType: 1, status: 1 });

// Virtual for getting the reported item
reportSchema.virtual('reportedItem').get(function() {
  return this.reportType === 'user' ? this.reportedUser : this.reportedPost;
});

// Method to mark as reviewed
reportSchema.methods.markAsReviewed = function(adminId, notes, action) {
  this.status = 'resolved';
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  if (notes) this.adminNotes = notes;
  if (action) this.actionTaken = action;
  return this.save();
};

// Static method to get report statistics
reportSchema.statics.getStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
  
  const result = {
    total: 0,
    pending: 0,
    reviewing: 0,
    resolved: 0,
    dismissed: 0
  };
  
  stats.forEach(stat => {
    result[stat._id] = stat.count;
    result.total += stat.count;
  });
  
  return result;
};

// Static method to get recent reports
reportSchema.statics.getRecent = async function(limit = 10) {
  return this.find({ status: 'pending' })
    .populate('reporter', 'name email avatar')
    .populate('reportedUser', 'name email avatar')
    .populate('reportedPost', 'content author images')
    .sort({ createdAt: -1 })
    .limit(limit);
};

const Report = mongoose.model('Report', reportSchema);

module.exports = Report;
