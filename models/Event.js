const mongoose = require('mongoose');
const crypto = require('crypto');

const RSVP_STATUSES = ['going', 'interested', 'declined'];
const INVITE_STATUSES = ['pending', 'accepted', 'declined'];
const CHECKIN_METHODS = ['qr', 'code', 'manual', 'geo'];

const rsvpSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: RSVP_STATUSES, required: true },
  respondedAt: { type: Date, default: Date.now }
}, { _id: false });

const inviteSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: INVITE_STATUSES, default: 'pending' },
  invitedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null }
}, { _id: false });

const checkInSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  time: { type: Date, default: Date.now },
  method: { type: String, enum: CHECKIN_METHODS, default: 'code' },
  locationName: { type: String, default: null }
}, { _id: false });

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 140 },
  description: { type: String, default: '', maxlength: 5000 },
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  startTime: { type: Date, required: true, index: true },
  endTime: { type: Date, default: null },
  timezone: { type: String, default: 'UTC' },
  isAllDay: { type: Boolean, default: false },
  visibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public', index: true },
  coverImage: { type: String, default: null },
  capacity: { type: Number, default: null },
  allowGuests: { type: Boolean, default: true },
  tags: [{ type: String, trim: true, lowercase: true }],
  // Simple location fields for discovery
  locationName: { type: String, default: null },
  locationAddress: { type: String, default: null },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  // GeoJSON for geospatial queries
  location: {
    type: { type: String, enum: ['Point'] },
    coordinates: { type: [Number] } // [longitude, latitude]
  },

  eventCode: { type: String, index: true }, // For check-ins/invite code

  invitations: [inviteSchema],
  rsvps: [rsvpSchema],
  checkIns: [checkInSchema],
  waitlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  attendeesCount: { type: Number, default: 0 },
  isApproved: { type: Boolean, default: true }, // Admin moderation
  rejectionReason: { type: String, default: null },
  isFlagged: { type: Boolean, default: false },
}, { timestamps: true });

// Text index for discovery
eventSchema.index({ title: 'text', description: 'text', locationName: 'text', tags: 'text' });
eventSchema.index({ organizer: 1, startTime: -1 });
eventSchema.index({ visibility: 1, startTime: -1 });
// Geospatial index for nearby events
eventSchema.index({ location: '2dsphere' });

eventSchema.pre('save', function(next) {
  if (!this.eventCode) {
    // 6-char alphanumeric code
    this.eventCode = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  }
  
  // Set location.coordinates from latitude/longitude if provided
  if (this.latitude != null && this.longitude != null) {
    this.location = {
      type: 'Point',
      coordinates: [this.longitude, this.latitude] // GeoJSON format: [longitude, latitude]
    };
  } else {
    // Clear location if coordinates are not provided
    this.location = undefined;
  }
  
  next();
});

eventSchema.methods.setRSVP = function(userId, status) {
  const idx = this.rsvps.findIndex(r => r.user.toString() === userId.toString());
  if (idx >= 0) {
    this.rsvps[idx].status = status;
    this.rsvps[idx].respondedAt = new Date();
  } else {
    this.rsvps.push({ user: userId, status, respondedAt: new Date() });
  }

  // Update attendees count (only those marked 'going')
  this.attendeesCount = this.rsvps.filter(r => r.status === 'going').length;
};

eventSchema.methods.inviteUsers = function(userIds) {
  const existing = new Set(this.invitations.map(i => i.user.toString()));
  userIds.forEach(uid => {
    if (!existing.has(uid.toString())) {
      this.invitations.push({ user: uid, status: 'pending', invitedAt: new Date() });
    }
  });
};

eventSchema.methods.checkInUser = function(userId, method = 'code', locationName = null) {
  const alreadyCheckedIn = this.checkIns.some(c => c.user.toString() === userId.toString());
  if (!alreadyCheckedIn) {
    this.checkIns.push({ user: userId, time: new Date(), method, locationName });
  }
};

eventSchema.methods.acceptInvite = function(userId) {
  const inv = this.invitations.find(i => i.user.toString() === userId.toString());
  if (inv) {
    inv.status = 'accepted';
    inv.respondedAt = new Date();
  }
};

eventSchema.methods.declineInvite = function(userId) {
  const inv = this.invitations.find(i => i.user.toString() === userId.toString());
  if (inv) {
    inv.status = 'declined';
    inv.respondedAt = new Date();
  }
};

eventSchema.methods.canRSVP = function(userId) {
  // Check capacity
  if (this.capacity && this.attendeesCount >= this.capacity) {
    return { allowed: false, reason: 'Event is at capacity', canWaitlist: true };
  }
  return { allowed: true };
};

eventSchema.methods.addToWaitlist = function(userId) {
  if (!this.waitlist.some(uid => uid.toString() === userId.toString())) {
    this.waitlist.push(userId);
  }
};

eventSchema.methods.removeFromWaitlist = function(userId) {
  this.waitlist = this.waitlist.filter(uid => uid.toString() !== userId.toString());
};

eventSchema.methods.promoteFromWaitlist = function() {
  // Move first person from waitlist to attendees if capacity allows
  if (this.capacity && this.attendeesCount < this.capacity && this.waitlist.length > 0) {
    const userId = this.waitlist.shift();
    return userId;
  }
  return null;
};

module.exports = mongoose.model('Event', eventSchema);
