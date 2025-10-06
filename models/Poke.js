const mongoose = require('mongoose');

const pokeSchema = new mongoose.Schema({
  // User who sent the poke
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // User who received the poke
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Type of poke
  pokeType: {
    type: String,
    enum: ['slap', 'kiss', 'hug', 'wave'],
    required: true
  },
  // Whether the recipient has seen the poke
  seen: {
    type: Boolean,
    default: false
  },
  // Whether the recipient has responded (poked back)
  responded: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for efficient querying
pokeSchema.index({ recipient: 1, seen: 0 }); // Find unseen pokes for a user
pokeSchema.index({ sender: 1, recipient: 1, createdAt: -1 }); // Find poke history between users

// Static method to get recent pokes for a user
pokeSchema.statics.getRecentPokes = async function(userId, limit = 20) {
  return this.find({ recipient: userId })
    .populate('sender', 'name avatar isOnline lastActive')
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Static method to get unseen pokes count
pokeSchema.statics.getUnseenCount = async function(userId) {
  return this.countDocuments({ recipient: userId, seen: false });
};

// Static method to mark poke as seen
pokeSchema.methods.markAsSeen = async function() {
  this.seen = true;
  await this.save();
};

// Static method to mark poke as responded
pokeSchema.methods.markAsResponded = async function() {
  this.responded = true;
  await this.save();
};

module.exports = mongoose.model('Poke', pokeSchema);
