const mongoose = require('mongoose');

const profileVisitorSchema = new mongoose.Schema({
  profileOwnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  visitorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  visitedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index to optimize queries and ensure we track each visit
profileVisitorSchema.index({ profileOwnerId: 1, visitorId: 1, visitedAt: -1 });

// Index for cleanup of old visits (optional - if you want to delete old data)
profileVisitorSchema.index({ visitedAt: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

module.exports = mongoose.model('ProfileVisitor', profileVisitorSchema);
