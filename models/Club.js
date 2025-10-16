const mongoose = require('mongoose');
const crypto = require('crypto');

const MEMBER_ROLES = ['owner', 'admin', 'moderator', 'member'];
const JOIN_REQUEST_STATUSES = ['pending', 'approved', 'rejected'];
const CLUB_TYPES = ['public', 'private'];
const POST_TYPES = ['discussion', 'announcement', 'poll'];

// Member schema
const memberSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: MEMBER_ROLES, default: 'member' },
  joinedAt: { type: Date, default: Date.now },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  canPost: { type: Boolean, default: true },
  canComment: { type: Boolean, default: true },
  isMuted: { type: Boolean, default: false },
  mutedUntil: { type: Date, default: null }
}, { _id: false });

// Join request schema
const joinRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: JOIN_REQUEST_STATUSES, default: 'pending' },
  requestedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null },
  respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  message: { type: String, default: '', maxlength: 500 } // Optional message from requester
}, { _id: false });

// Discussion post schema
const discussionPostSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: POST_TYPES, default: 'discussion' },
  content: { type: String, required: false, default: '', maxlength: 5000 }, // Optional: Allow image-only posts
  // Media fields for images and videos
  media: [{
    url: { type: String, required: true },
    type: { type: String, enum: ['image', 'video'], required: true },
    thumbnail: { type: String, default: null }, // For video thumbnails
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration: { type: Number, default: null } // For videos (in seconds)
  }],
  isPinned: { type: Boolean, default: false },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likesCount: { type: Number, default: 0 },
  commentsCount: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deletedAt: { type: Date, default: null },
  // Poll specific fields
  pollOptions: [{
    text: { type: String, maxlength: 200 },
    votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    votesCount: { type: Number, default: 0 }
  }],
  pollEndsAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

// Add validation to ensure either content or media exists
discussionPostSchema.pre('validate', function(next) {
  // Skip validation for deleted posts
  if (this.isDeleted) {
    return next();
  }
  
  const hasContent = this.content && this.content.trim().length > 0;
  const hasMedia = this.media && this.media.length > 0;
  
  if (!hasContent && !hasMedia) {
    return next(new Error('Either content or media must be provided for a discussion post'));
  }
  
  next();
});

// Comment schema for discussions
const commentSchema = new mongoose.Schema({
  discussionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, maxlength: 2000 },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likesCount: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deletedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

// File/media schema
const clubFileSchema = new mongoose.Schema({
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  fileType: { type: String, required: true }, // 'image', 'video', 'document', 'audio', 'other'
  fileSize: { type: Number, required: true }, // in bytes
  mimeType: { type: String, required: true },
  description: { type: String, default: '', maxlength: 500 },
  downloadCount: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now }
});

// Club rule schema
const clubRuleSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 100 },
  description: { type: String, required: true, maxlength: 1000 },
  order: { type: Number, default: 0 }
}, { _id: false });

// Main club schema
const clubSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, required: true, maxlength: 2000 },
  type: { type: String, enum: CLUB_TYPES, default: 'public', index: true },
  category: { type: String, default: null, index: true }, // e.g., 'sports', 'technology', 'arts', 'gaming', etc.
  tags: [{ type: String, trim: true, lowercase: true }],
  
  coverImage: { type: String, default: null },
  avatar: { type: String, default: null },
  
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  members: [memberSchema],
  membersCount: { type: Number, default: 1 }, // Owner is always the first member
  
  joinRequests: [joinRequestSchema],
  inviteCode: { type: String, unique: true, sparse: true }, // For private clubs
  
  // Club settings
  requireApproval: { type: Boolean, default: false }, // For public clubs, require approval to join
  allowMemberInvites: { type: Boolean, default: true },
  allowFileSharing: { type: Boolean, default: true },
  maxMembers: { type: Number, default: null }, // null = unlimited
  
  // Content
  discussions: [discussionPostSchema],
  discussionsCount: { type: Number, default: 0 },
  comments: [commentSchema], // Comments on discussions
  files: [clubFileSchema],
  filesCount: { type: Number, default: 0 },
  rules: [clubRuleSchema],
  
  // Moderation
  isFlagged: { type: Boolean, default: false },
  isApproved: { type: Boolean, default: true },
  rejectionReason: { type: String, default: null },
  
  // Stats
  lastActivityAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Indexes for search and discovery
clubSchema.index({ name: 'text', description: 'text', category: 'text', tags: 'text' });
clubSchema.index({ type: 1, membersCount: -1 });
clubSchema.index({ category: 1, membersCount: -1 });
clubSchema.index({ owner: 1, createdAt: -1 });
clubSchema.index({ 'members.user': 1 });

// Pre-save middleware
clubSchema.pre('save', function(next) {
  // Generate invite code for private clubs if not exists
  if (this.type === 'private' && !this.inviteCode) {
    this.inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  }
  
  // Update counts
  this.membersCount = this.members.length;
  this.discussionsCount = this.discussions.filter(d => !d.isDeleted).length;
  this.filesCount = this.files.length;
  
  next();
});

// Methods

// Check if user is a member
clubSchema.methods.isMember = function(userId) {
  return this.members.some(m => m.user.toString() === userId.toString());
};

// Check if user has specific role
clubSchema.methods.hasRole = function(userId, role) {
  const member = this.members.find(m => m.user.toString() === userId.toString());
  if (!member) return false;
  
  const roleHierarchy = { owner: 4, admin: 3, moderator: 2, member: 1 };
  const userRoleLevel = roleHierarchy[member.role] || 0;
  const requiredRoleLevel = roleHierarchy[role] || 0;
  
  return userRoleLevel >= requiredRoleLevel;
};

// Check if user can moderate (owner, admin, or moderator)
clubSchema.methods.canModerate = function(userId) {
  return this.hasRole(userId, 'moderator');
};

// Check if user can manage club (owner or admin)
clubSchema.methods.canManage = function(userId) {
  return this.hasRole(userId, 'admin');
};

// Add member
clubSchema.methods.addMember = function(userId, role = 'member', invitedBy = null) {
  if (this.isMember(userId)) {
    throw new Error('User is already a member');
  }
  
  if (this.maxMembers && this.members.length >= this.maxMembers) {
    throw new Error('Club has reached maximum members');
  }
  
  this.members.push({
    user: userId,
    role,
    joinedAt: new Date(),
    invitedBy,
    canPost: true,
    canComment: true,
    isMuted: false
  });
  
  this.membersCount = this.members.length;
  this.lastActivityAt = new Date();
};

// Remove member
clubSchema.methods.removeMember = function(userId) {
  const index = this.members.findIndex(m => m.user.toString() === userId.toString());
  if (index === -1) {
    throw new Error('User is not a member');
  }
  
  // Cannot remove owner
  if (this.members[index].role === 'owner') {
    throw new Error('Cannot remove club owner');
  }
  
  this.members.splice(index, 1);
  this.membersCount = this.members.length;
  this.lastActivityAt = new Date();
};

// Update member role
clubSchema.methods.updateMemberRole = function(userId, newRole) {
  const member = this.members.find(m => m.user.toString() === userId.toString());
  if (!member) {
    throw new Error('User is not a member');
  }
  
  // Cannot change owner role
  if (member.role === 'owner' || newRole === 'owner') {
    throw new Error('Cannot change owner role');
  }
  
  member.role = newRole;
  this.lastActivityAt = new Date();
};

// Mute member
clubSchema.methods.muteMember = function(userId, duration = null) {
  const member = this.members.find(m => m.user.toString() === userId.toString());
  if (!member) {
    throw new Error('User is not a member');
  }
  
  member.isMuted = true;
  member.canPost = false;
  member.canComment = false;
  
  if (duration) {
    member.mutedUntil = new Date(Date.now() + duration);
  }
  
  this.lastActivityAt = new Date();
};

// Unmute member
clubSchema.methods.unmuteMember = function(userId) {
  const member = this.members.find(m => m.user.toString() === userId.toString());
  if (!member) {
    throw new Error('User is not a member');
  }
  
  member.isMuted = false;
  member.canPost = true;
  member.canComment = true;
  member.mutedUntil = null;
  
  this.lastActivityAt = new Date();
};

// Add join request
clubSchema.methods.addJoinRequest = function(userId, message = '') {
  // Check if already a member
  if (this.isMember(userId)) {
    throw new Error('User is already a member');
  }
  
  // Check if request already exists
  const existingRequest = this.joinRequests.find(
    r => r.user.toString() === userId.toString() && r.status === 'pending'
  );
  
  if (existingRequest) {
    throw new Error('Join request already pending');
  }
  
  this.joinRequests.push({
    user: userId,
    status: 'pending',
    requestedAt: new Date(),
    message
  });
};

// Approve join request
clubSchema.methods.approveJoinRequest = function(userId, responderId) {
  const request = this.joinRequests.find(
    r => r.user.toString() === userId.toString() && r.status === 'pending'
  );
  
  if (!request) {
    throw new Error('Join request not found');
  }
  
  request.status = 'approved';
  request.respondedAt = new Date();
  request.respondedBy = responderId;
  
  // Add as member
  this.addMember(userId, 'member');
};

// Reject join request
clubSchema.methods.rejectJoinRequest = function(userId, responderId) {
  const request = this.joinRequests.find(
    r => r.user.toString() === userId.toString() && r.status === 'pending'
  );
  
  if (!request) {
    throw new Error('Join request not found');
  }
  
  request.status = 'rejected';
  request.respondedAt = new Date();
  request.respondedBy = responderId;
};

// Add discussion post
clubSchema.methods.addDiscussion = function(authorId, content, type = 'discussion', media = [], pollOptions = null, pollEndsAt = null) {
  const member = this.members.find(m => m.user.toString() === authorId.toString());
  if (!member) {
    throw new Error('User is not a member');
  }
  
  if (!member.canPost) {
    throw new Error('User is not allowed to post');
  }
  
  const discussion = {
    author: authorId,
    type,
    content,
    media: media || [],
    isPinned: false,
    likes: [],
    likesCount: 0,
    commentsCount: 0,
    isDeleted: false,
    createdAt: new Date()
  };
  
  if (type === 'poll' && pollOptions && pollOptions.length > 0) {
    discussion.pollOptions = pollOptions.map(opt => ({
      text: opt,
      votes: [],
      votesCount: 0
    }));
    discussion.pollEndsAt = pollEndsAt;
  }
  
  this.discussions.push(discussion);
  this.discussionsCount = this.discussions.filter(d => !d.isDeleted).length;
  this.lastActivityAt = new Date();
  
  return this.discussions[this.discussions.length - 1];
};

// Add file
clubSchema.methods.addFile = function(uploaderId, fileData) {
  const member = this.members.find(m => m.user.toString() === uploaderId.toString());
  if (!member) {
    throw new Error('User is not a member');
  }
  
  if (!this.allowFileSharing) {
    throw new Error('File sharing is not allowed in this club');
  }
  
  this.files.push({
    uploadedBy: uploaderId,
    fileName: fileData.fileName,
    fileUrl: fileData.fileUrl,
    fileType: fileData.fileType,
    fileSize: fileData.fileSize,
    mimeType: fileData.mimeType,
    description: fileData.description || '',
    downloadCount: 0,
    uploadedAt: new Date()
  });
  
  this.filesCount = this.files.length;
  this.lastActivityAt = new Date();
  
  return this.files[this.files.length - 1];
};

// Add comment to discussion
clubSchema.methods.addComment = function(discussionId, authorId, content) {
  const member = this.members.find(m => m.user.toString() === authorId.toString());
  if (!member) {
    throw new Error('User is not a member');
  }
  
  if (!member.canComment) {
    throw new Error('User is not allowed to comment');
  }
  
  const discussion = this.discussions.id(discussionId);
  if (!discussion || discussion.isDeleted) {
    throw new Error('Discussion not found');
  }
  
  const comment = {
    discussionId,
    author: authorId,
    content,
    likes: [],
    likesCount: 0,
    isDeleted: false,
    createdAt: new Date()
  };
  
  this.comments.push(comment);
  discussion.commentsCount = this.comments.filter(
    c => c.discussionId.toString() === discussionId.toString() && !c.isDeleted
  ).length;
  this.lastActivityAt = new Date();
  
  return this.comments[this.comments.length - 1];
};

// Get comments for a discussion
clubSchema.methods.getComments = function(discussionId) {
  return this.comments.filter(
    c => c.discussionId.toString() === discussionId.toString() && !c.isDeleted
  );
};

module.exports = mongoose.model('Club', clubSchema);
