const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema({
  blocker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  blocked: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Compound index to prevent duplicate blocks and optimize queries
blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });

// Static method to check if user A has blocked user B
blockSchema.statics.isBlocked = async function(userA, userB) {
  const block = await this.findOne({
    $or: [
      { blocker: userA, blocked: userB },
      { blocker: userB, blocked: userA }
    ]
  });
  return !!block;
};

// Static method to get all users blocked by a user
blockSchema.statics.getBlockedUsers = async function(userId) {
  const blocks = await this.find({ blocker: userId }).select('blocked');
  return blocks.map(block => block.blocked);
};

// Static method to get all users who have blocked a user
blockSchema.statics.getBlockers = async function(userId) {
  const blocks = await this.find({ blocked: userId }).select('blocker');
  return blocks.map(block => block.blocker);
};

// Static method to get all related block relationships (both ways)
blockSchema.statics.getAllBlockRelationships = async function(userId) {
  const blocks = await this.find({
    $or: [
      { blocker: userId },
      { blocked: userId }
    ]
  }).select('blocker blocked');
  
  const blockedUsers = new Set();
  blocks.forEach(block => {
    if (block.blocker.toString() === userId.toString()) {
      blockedUsers.add(block.blocked.toString());
    } else {
      blockedUsers.add(block.blocker.toString());
    }
  });
  
  return Array.from(blockedUsers);
};

module.exports = mongoose.model('Block', blockSchema);
