const mongoose = require('mongoose');

const photoSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  imageUrl: {
    type: String,
    required: [true, 'Image URL is required'],
    trim: true
  },
  caption: {
    type: String,
    trim: true,
    maxlength: [500, 'Caption cannot exceed 500 characters'],
    default: ''
  },
  visibility: {
    type: String,
    enum: ['public', 'followers', 'private'],
    default: 'followers'
  },
  // Optional tags for photos
  tags: [{
    type: String,
    trim: true,
    maxlength: 50
  }],
  // Photo metadata
  metadata: {
    width: Number,
    height: Number,
    fileSize: Number,
    mimeType: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
photoSchema.index({ owner: 1, createdAt: -1 });
photoSchema.index({ visibility: 1, createdAt: -1 });

// Update the updatedAt timestamp before saving
photoSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Photo', photoSchema);
