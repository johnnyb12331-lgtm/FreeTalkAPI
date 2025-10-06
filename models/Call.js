const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  callId: {
    type: String,
    required: true,
    unique: true
  },
  caller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  callee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  callType: {
    type: String,
    enum: ['audio', 'video'],
    required: true
  },
  status: {
    type: String,
    enum: ['initiated', 'ringing', 'accepted', 'declined', 'missed', 'ended', 'busy', 'timeout', 'failed'],
    default: 'initiated'
  },
  startTime: {
    type: Date,
    default: null
  },
  endTime: {
    type: Date,
    default: null
  },
  duration: {
    type: Number, // in seconds
    default: 0
  }
}, {
  timestamps: true
});

// Index for efficient queries
callSchema.index({ caller: 1, createdAt: -1 });
callSchema.index({ callee: 1, createdAt: -1 });
// Note: callId index is automatically created by unique: true property

// Virtual for call duration in readable format
callSchema.virtual('durationFormatted').get(function() {
  if (!this.duration) return '0s';
  const minutes = Math.floor(this.duration / 60);
  const seconds = this.duration % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
});

// Method to mark call as answered
callSchema.methods.markAsAccepted = function() {
  this.status = 'accepted';
  this.startTime = new Date();
  return this.save();
};

// Method to mark call as ended
callSchema.methods.markAsEnded = function() {
  this.status = 'ended';
  this.endTime = new Date();
  if (this.startTime) {
    this.duration = Math.floor((this.endTime - this.startTime) / 1000);
  }
  return this.save();
};

// Method to mark call as declined
callSchema.methods.markAsDeclined = function() {
  this.status = 'declined';
  return this.save();
};

// Method to mark call as missed
callSchema.methods.markAsMissed = function() {
  this.status = 'missed';
  return this.save();
};

// Method to mark call as timeout
callSchema.methods.markAsTimeout = function() {
  this.status = 'timeout';
  return this.save();
};

// Static method to get call history for a user
callSchema.statics.getCallHistory = async function(userId, options = {}) {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const calls = await this.find({
    $or: [
      { caller: userId },
      { callee: userId }
    ]
  })
    .populate('caller', 'name email avatar')
    .populate('callee', 'name email avatar')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean();

  const total = await this.countDocuments({
    $or: [
      { caller: userId },
      { callee: userId }
    ]
  });

  return {
    calls,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

// Static method to get missed calls count
callSchema.statics.getMissedCallsCount = async function(userId) {
  return await this.countDocuments({
    callee: userId,
    status: 'missed'
  });
};

const Call = mongoose.model('Call', callSchema);

module.exports = Call;
