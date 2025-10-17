const express = require('express');
const { body, validationResult, query, param } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const checkSuspension = require('../middleware/checkSuspension');
const { generalLimiter, createContentLimiter, searchLimiter } = require('../middleware/rateLimiter');
const Club = require('../models/Club');
const Notification = require('../models/Notification');
const achievementService = require('../services/achievementService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/clubs';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|mp4|mp3|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// All club routes require auth
router.use(authenticateToken);
router.use(generalLimiter);

// Validation schemas
const createClubValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }).withMessage('Name must be max 100 characters'),
  body('description').trim().notEmpty().withMessage('Description is required').isLength({ max: 2000 }).withMessage('Description must be max 2000 characters'),
  body('type').optional().isIn(['public', 'private']).withMessage('Type must be public or private'),
  body('category').optional({ nullable: true }).isString().withMessage('Category must be a string'),
  body('tags').optional({ nullable: true }).isArray().withMessage('Tags must be an array'),
  body('tags.*').optional().isString().withMessage('Each tag must be a string'),
  body('requireApproval').optional({ nullable: true }).isBoolean().withMessage('requireApproval must be a boolean'),
  body('allowMemberInvites').optional({ nullable: true }).isBoolean().withMessage('allowMemberInvites must be a boolean'),
  body('allowFileSharing').optional({ nullable: true }).isBoolean().withMessage('allowFileSharing must be a boolean'),
  body('maxMembers').optional({ nullable: true }).isInt({ min: 1 }).withMessage('maxMembers must be an integer >= 1')
];

const createDiscussionValidation = [
  body('content').trim().notEmpty().isLength({ max: 5000 }),
  body('type').optional().isIn(['discussion', 'announcement', 'poll']),
  body('pollOptions').optional().isArray({ min: 2, max: 10 }),
  body('pollEndsAt').optional().isISO8601().toDate()
];

const createCommentValidation = [
  body('content').trim().notEmpty().isLength({ max: 2000 })
];

// ===== CLUB CRUD =====

// Create club
router.post('/', createContentLimiter, checkSuspension, createClubValidation, async (req, res) => {
  // Enhanced debug logging
  console.log('========================================');
  console.log('🏗️  CREATE CLUB REQUEST');
  console.log('========================================');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('👤 User ID:', req.user?._id);
  console.log('👤 User Name:', req.user?.name);
  console.log('👤 User Email:', req.user?.email);
  console.log('📦 Request Body:', JSON.stringify(req.body, null, 2));
  console.log('🌐 IP Address:', req.ip);
  console.log('🔧 User Agent:', req.get('user-agent'));
  
  try {
    // Validation check
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('❌ VALIDATION ERRORS:');
      console.error(JSON.stringify(errors.array(), null, 2));
      console.error('Validation failed fields:', errors.array().map(e => e.path).join(', '));
      console.log('========================================\n');
      return res.status(400).json({ 
        success: false, 
        errors: errors.array(),
        debug: {
          timestamp: new Date().toISOString(),
          userId: req.user?._id,
          fieldsWithErrors: errors.array().map(e => e.path)
        }
      });
    }

    console.log('✅ Validation passed');

    // Build club data
    const clubData = {
      name: req.body.name,
      description: req.body.description,
      type: req.body.type || 'public',
      category: req.body.category || null,
      tags: req.body.tags || [],
      owner: req.user._id,
      coverImage: req.body.coverImage || null,
      avatar: req.body.avatar || null,
      requireApproval: req.body.requireApproval || false,
      allowMemberInvites: req.body.allowMemberInvites !== false,
      allowFileSharing: req.body.allowFileSharing !== false,
      maxMembers: req.body.maxMembers || null,
      members: [{
        user: req.user._id,
        role: 'owner',
        joinedAt: new Date()
      }],
      rules: req.body.rules || []
    };

    console.log('📋 Prepared Club Data:', JSON.stringify(clubData, null, 2));
    console.log('🔄 Attempting to create club in database...');

    const club = await Club.create(clubData);

    console.log('✅ Club created successfully!');
    console.log('🆔 Club ID:', club._id);
    console.log('📛 Club Name:', club.name);
    console.log('👥 Members Count:', club.membersCount);
    console.log('🔑 Type:', club.type);
    console.log('📁 Category:', club.category);

    // Populate owner and members.user fields before returning
    await club.populate([
      { path: 'owner', select: 'name avatar isVerified' },
      { path: 'members.user', select: 'name avatar isVerified' }
    ]);

    console.log('✅ Populated owner and members');

    // Check for achievements - club creation
    try {
      const newAchievements = await achievementService.checkAndAwardAchievements(
        req.user._id,
        'club_create',
        { clubId: club._id }
      );
      if (newAchievements.length > 0) {
        console.log('🏆 New achievements unlocked:', newAchievements.map(a => a.achievement.name).join(', '));
      }
    } catch (achievementError) {
      console.error('⚠️  Achievement check failed:', achievementError.message);
      // Don't fail the request if achievement check fails
    }

    // Emit real-time event
    const io = req.app.get('io');
    if (io) {
      console.log('📡 Emitting real-time event: club:created');
      io.emit('club:created', { clubId: club._id.toString(), club });
    } else {
      console.warn('⚠️  Socket.IO instance not found - real-time event not emitted');
    }

    console.log('========================================\n');
    return res.status(201).json({ success: true, data: club });
  } catch (error) {
    console.error('========================================');
    console.error('❌ CREATE CLUB ERROR');
    console.error('========================================');
    console.error('Error Name:', error.name);
    console.error('Error Message:', error.message);
    console.error('Error Code:', error.code);
    console.error('Error Stack:', error.stack);
    
    // MongoDB specific error details
    if (error.name === 'ValidationError') {
      console.error('🔍 MongoDB Validation Errors:');
      Object.keys(error.errors || {}).forEach(field => {
        console.error(`  - Field: ${field}`);
        console.error(`    Kind: ${error.errors[field].kind}`);
        console.error(`    Value: ${error.errors[field].value}`);
        console.error(`    Message: ${error.errors[field].message}`);
      });
    }
    
    if (error.name === 'MongoServerError' || error.code === 11000) {
      console.error('🔍 Duplicate Key Error:');
      console.error('  Index:', error.keyPattern);
      console.error('  Value:', error.keyValue);
    }
    
    console.error('📦 Request Body at error:', JSON.stringify(req.body, null, 2));
    console.error('👤 User at error:', {
      id: req.user?._id,
      name: req.user?.name,
      email: req.user?.email
    });
    console.error('========================================\n');
    
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to create club',
      error: error.message,
      errorType: error.name,
      debug: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        code: error.code,
        validationErrors: error.errors ? Object.keys(error.errors).map(field => ({
          field,
          message: error.errors[field].message,
          kind: error.errors[field].kind,
          value: error.errors[field].value
        })) : undefined
      } : undefined
    });
  }
});

// ===== CLUB DISCOVERY ===== (Must be before /:id route)

// Discover clubs
router.get('/discover/list', searchLimiter, async (req, res) => {
  console.log('========================================');
  console.log('🔍 DISCOVER CLUBS REQUEST');
  console.log('========================================');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('👤 User ID:', req.user?._id);
  console.log('👤 User Name:', req.user?.name);
  console.log('🔍 Query Parameters:', JSON.stringify(req.query, null, 2));
  console.log('🌐 IP Address:', req.ip);
  
  try {
    const { page = 1, limit = 20, search, category, sort = 'popular' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    console.log('📊 Pagination:', { page: parseInt(page), limit: parseInt(limit), skip });

    const query = { type: 'public', isApproved: true };

    // Search
    if (search) {
      query.$text = { $search: search };
      console.log('🔎 Text search applied:', search);
    }

    // Category filter
    if (category && category !== 'all') {
      query.category = category;
      console.log('📁 Category filter applied:', category);
    }

    console.log('🔧 Final MongoDB Query:', JSON.stringify(query, null, 2));

    // Sort
    let sortQuery = {};
    switch (sort) {
      case 'popular':
        sortQuery = { membersCount: -1, lastActivityAt: -1 };
        break;
      case 'newest':
        sortQuery = { createdAt: -1 };
        break;
      case 'active':
        sortQuery = { lastActivityAt: -1 };
        break;
      default:
        sortQuery = { membersCount: -1 };
    }

    console.log('🔀 Sort criteria:', JSON.stringify(sortQuery, null, 2));
    console.log('🔄 Executing database query...');

    const startTime = Date.now();
    const clubs = await Club.find(query)
      .sort(sortQuery)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('owner', 'name avatar isVerified')
      .select('name description type category tags coverImage avatar membersCount discussionsCount lastActivityAt createdAt');

    const queryTime = Date.now() - startTime;
    console.log(`⏱️  Query execution time: ${queryTime}ms`);
    console.log('📊 Clubs found:', clubs.length);

    const total = await Club.countDocuments(query);
    const totalPages = Math.ceil(total / parseInt(limit));

    console.log('📈 Total Results:', {
      total,
      currentPage: parseInt(page),
      totalPages,
      resultsOnPage: clubs.length,
      hasNextPage: parseInt(page) < totalPages,
      hasPreviousPage: parseInt(page) > 1
    });

    if (clubs.length === 0) {
      console.warn('⚠️  No clubs found with current filters');
      console.log('🔍 Debugging info:');
      console.log('  - Total public clubs:', await Club.countDocuments({ type: 'public' }));
      console.log('  - Total approved clubs:', await Club.countDocuments({ isApproved: true }));
      console.log('  - Total public & approved:', await Club.countDocuments({ type: 'public', isApproved: true }));
      if (category && category !== 'all') {
        console.log(`  - Clubs in category "${category}":`, await Club.countDocuments({ category, type: 'public', isApproved: true }));
      }
    } else {
      console.log('✅ Sample club results:');
      clubs.slice(0, 3).forEach((club, idx) => {
        console.log(`  ${idx + 1}. ${club.name} - ${club.membersCount} members - Category: ${club.category || 'none'}`);
      });
    }

    console.log('========================================\n');

    return res.json({
      success: true,
      data: {
        clubs,
        total,
        page: parseInt(page),
        pages: totalPages
      },
      debug: process.env.NODE_ENV === 'development' ? {
        queryTime: `${queryTime}ms`,
        query,
        sortQuery,
        filters: { search, category, sort }
      } : undefined
    });
  } catch (error) {
    console.error('========================================');
    console.error('❌ DISCOVER CLUBS ERROR');
    console.error('========================================');
    console.error('Error Name:', error.name);
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    console.error('Query Parameters:', JSON.stringify(req.query, null, 2));
    console.error('User:', {
      id: req.user?._id,
      name: req.user?.name,
      email: req.user?.email
    });
    
    // Check if text index exists for search
    if (req.query.search) {
      console.error('🔍 Text search was attempted');
      console.error('⚠️  Verify text index exists on Club model');
      try {
        const indexes = await Club.collection.getIndexes();
        console.error('📋 Current indexes:', Object.keys(indexes));
      } catch (indexError) {
        console.error('❌ Could not retrieve indexes:', indexError.message);
      }
    }
    
    console.error('========================================\n');
    
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to discover clubs',
      error: error.message,
      errorType: error.name,
      debug: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        query: req.query
      } : undefined
    });
  }
});

// Get my clubs
router.get('/my/list', async (req, res) => {
  console.log('========================================');
  console.log('👤 GET MY CLUBS REQUEST');
  console.log('========================================');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('👤 User ID:', req.user?._id);
  console.log('👤 User Name:', req.user?.name);
  console.log('🔍 Query Parameters:', JSON.stringify(req.query, null, 2));
  
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    console.log('📊 Pagination:', { page: parseInt(page), limit: parseInt(limit), skip });
    console.log('🔧 MongoDB Query:', { 'members.user': req.user._id });
    console.log('🔄 Executing database query...');

    const startTime = Date.now();
    const clubs = await Club.find({
      'members.user': req.user._id
    })
      .sort({ lastActivityAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('owner', 'name avatar isVerified')
      .select('name description type category tags coverImage avatar membersCount discussionsCount lastActivityAt createdAt')
      .lean();

    const queryTime = Date.now() - startTime;
    console.log(`⏱️  Query execution time: ${queryTime}ms`);
    console.log('📊 Clubs found:', clubs.length);

    const total = await Club.countDocuments({ 'members.user': req.user._id });
    const totalPages = Math.ceil(total / parseInt(limit));

    console.log('📈 User Club Stats:', {
      totalClubsMember: total,
      currentPage: parseInt(page),
      totalPages,
      resultsOnPage: clubs.length
    });

    if (clubs.length === 0) {
      console.log('ℹ️  User is not a member of any clubs');
    } else {
      console.log('✅ User clubs:');
      clubs.forEach((club, idx) => {
        console.log(`  ${idx + 1}. ${club.name} (${club.type}) - ${club.membersCount} members`);
      });
    }

    console.log('========================================\n');

    return res.json({
      success: true,
      data: {
        clubs,
        total,
        page: parseInt(page),
        pages: totalPages
      },
      debug: process.env.NODE_ENV === 'development' ? {
        queryTime: `${queryTime}ms`,
        userId: req.user._id
      } : undefined
    });
  } catch (error) {
    console.error('========================================');
    console.error('❌ GET MY CLUBS ERROR');
    console.error('========================================');
    console.error('Error Name:', error.name);
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    console.error('Query Parameters:', JSON.stringify(req.query, null, 2));
    console.error('User:', {
      id: req.user?._id,
      name: req.user?.name,
      email: req.user?.email
    });
    
    // Check if index exists on members.user
    try {
      const indexes = await Club.collection.getIndexes();
      console.error('📋 Current indexes:', Object.keys(indexes));
      const hasMemberIndex = Object.keys(indexes).some(key => key.includes('members.user'));
      if (!hasMemberIndex) {
        console.error('⚠️  WARNING: No index found on members.user field - query may be slow!');
      }
    } catch (indexError) {
      console.error('❌ Could not retrieve indexes:', indexError.message);
    }
    
    console.error('========================================\n');
    
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch clubs',
      error: error.message,
      errorType: error.name,
      debug: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        userId: req.user?._id
      } : undefined
    });
  }
});

// Get club by ID
router.get('/:id', param('id').isMongoId(), async (req, res) => {
  console.log('========================================');
  console.log('🔍 GET CLUB BY ID REQUEST');
  console.log('========================================');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('🆔 Club ID:', req.params.id);
  console.log('👤 User ID:', req.user?._id);
  console.log('👤 User Name:', req.user?.name);
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('❌ Validation Error: Invalid MongoDB ObjectId');
      console.error('Provided ID:', req.params.id);
      console.log('========================================\n');
      return res.status(400).json({ 
        success: false, 
        errors: errors.array(),
        message: 'Invalid club ID format'
      });
    }

    console.log('🔄 Fetching club from database...');
    const startTime = Date.now();
    
    const club = await Club.findById(req.params.id)
      .populate('owner', 'name avatar isVerified')
      .populate('members.user', 'name avatar isVerified')
      .populate('discussions.author', 'name avatar isVerified')
      .populate('files.uploadedBy', 'name avatar');

    const queryTime = Date.now() - startTime;
    console.log(`⏱️  Query execution time: ${queryTime}ms`);

    if (!club) {
      console.warn('⚠️  Club not found in database');
      console.log('🔍 Checking if club was deleted...');
      // Try to find if club exists but was soft-deleted
      const deletedClub = await Club.findOne({ _id: req.params.id, isDeleted: true });
      if (deletedClub) {
        console.log('ℹ️  Club exists but is marked as deleted');
      } else {
        console.log('ℹ️  Club ID does not exist in database');
      }
      console.log('========================================\n');
      return res.status(404).json({ 
        success: false, 
        message: 'Club not found',
        debug: process.env.NODE_ENV === 'development' ? {
          clubId: req.params.id,
          wasDeleted: !!deletedClub
        } : undefined
      });
    }

    console.log('✅ Club found:', club.name);
    console.log('📊 Club Details:', {
      id: club._id,
      name: club.name,
      type: club.type,
      category: club.category,
      membersCount: club.membersCount,
      discussionsCount: club.discussionsCount,
      filesCount: club.filesCount,
      owner: club.owner?.name || club.owner,
      isApproved: club.isApproved,
      isFlagged: club.isFlagged
    });

    // Check access for private clubs
    if (club.type === 'private' && !club.isMember(req.user._id)) {
      console.warn('⚠️  Access denied: Private club and user is not a member');
      console.log('👤 User trying to access:', req.user._id);
      console.log('👥 Club members:', club.members.map(m => m.user?._id || m.user).join(', '));
      console.log('========================================\n');
      return res.status(403).json({ 
        success: false, 
        message: 'This club is private',
        clubName: club.name,
        requiresMembership: true
      });
    }

    const isMember = club.isMember(req.user._id);
    console.log('👤 User membership status:', isMember ? 'Member' : 'Not a member');

    console.log('========================================\n');
    return res.json({ 
      success: true, 
      data: club,
      debug: process.env.NODE_ENV === 'development' ? {
        queryTime: `${queryTime}ms`,
        isMember,
        memberRole: isMember ? club.members.find(m => m.user._id.toString() === req.user._id.toString())?.role : null
      } : undefined
    });
  } catch (error) {
    console.error('========================================');
    console.error('❌ GET CLUB BY ID ERROR');
    console.error('========================================');
    console.error('Error Name:', error.name);
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    console.error('Club ID:', req.params.id);
    console.error('User:', {
      id: req.user?._id,
      name: req.user?.name
    });
    console.error('========================================\n');
    
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch club',
      error: error.message,
      debug: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        clubId: req.params.id
      } : undefined
    });
  }
});

// Update club
router.put('/:id', checkSuspension, param('id').isMongoId(), createClubValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Only owner or admin can update
    if (!club.canManage(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to update this club' });
    }

    // Update fields
    club.name = req.body.name || club.name;
    club.description = req.body.description || club.description;
    club.category = req.body.category !== undefined ? req.body.category : club.category;
    club.tags = req.body.tags || club.tags;
    club.coverImage = req.body.coverImage !== undefined ? req.body.coverImage : club.coverImage;
    club.avatar = req.body.avatar !== undefined ? req.body.avatar : club.avatar;
    club.requireApproval = req.body.requireApproval !== undefined ? req.body.requireApproval : club.requireApproval;
    club.allowMemberInvites = req.body.allowMemberInvites !== undefined ? req.body.allowMemberInvites : club.allowMemberInvites;
    club.allowFileSharing = req.body.allowFileSharing !== undefined ? req.body.allowFileSharing : club.allowFileSharing;
    club.maxMembers = req.body.maxMembers !== undefined ? req.body.maxMembers : club.maxMembers;

    if (req.body.rules) {
      club.rules = req.body.rules;
    }

    await club.save();

    // Emit real-time event to club members
    const io = req.app.get('io');
    club.members.forEach(member => {
      io.to(`user:${member.user.toString()}`).emit('club:updated', {
        clubId: club._id.toString(),
        updates: { name: club.name, description: club.description }
      });
    });

    return res.json({ success: true, data: club });
  } catch (error) {
    console.error('Update club error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update club' });
  }
});

// Upload club image (cover image)
router.post('/:id/upload-image', checkSuspension, param('id').isMongoId(), upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image uploaded' });
    }

    // Validate that it's an image
    if (!req.file.mimetype.startsWith('image/')) {
      // Delete the uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'File must be an image' });
    }

    const club = await Club.findById(req.params.id);
    if (!club) {
      // Delete the uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Only owner or admin can upload club image
    if (!club.canManage(req.user._id)) {
      // Delete the uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ 
        success: false, 
        message: 'Only club owner or admin can upload club image' 
      });
    }

    // Delete old cover image if it exists
    if (club.coverImage) {
      const oldImagePath = path.join(__dirname, '..', club.coverImage);
      if (fs.existsSync(oldImagePath)) {
        try {
          fs.unlinkSync(oldImagePath);
        } catch (err) {
          console.error('Error deleting old club image:', err);
        }
      }
    }

    // Update club with new image
    club.coverImage = `/uploads/clubs/${req.file.filename}`;
    await club.save();

    // Emit real-time event to club members
    const io = req.app.get('io');
    club.members.forEach(member => {
      io.to(`user:${member.user.toString()}`).emit('club:updated', {
        clubId: club._id.toString(),
        updates: { coverImage: club.coverImage }
      });
    });

    return res.json({ 
      success: true, 
      message: 'Club image uploaded successfully',
      data: { coverImage: club.coverImage }
    });
  } catch (error) {
    console.error('Upload club image error:', error);
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to upload club image' 
    });
  }
});

// Delete club
router.delete('/:id', checkSuspension, param('id').isMongoId(), async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Only owner can delete
    if (club.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the club owner can delete the club' });
    }

    // Notify all members
    const io = req.app.get('io');
    club.members.forEach(member => {
      if (member.user.toString() !== req.user._id.toString()) {
        io.to(`user:${member.user.toString()}`).emit('club:deleted', {
          clubId: club._id.toString(),
          clubName: club.name
        });
      }
    });

    await Club.findByIdAndDelete(req.params.id);

    return res.json({ success: true, message: 'Club deleted successfully' });
  } catch (error) {
    console.error('Delete club error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete club' });
  }
});

// ===== MEMBERSHIP =====

// Join club
router.post('/:id/join', checkSuspension, param('id').isMongoId(), async (req, res) => {
  console.log('========================================');
  console.log('➕ JOIN CLUB REQUEST');
  console.log('========================================');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('🆔 Club ID:', req.params.id);
  console.log('👤 User ID:', req.user?._id);
  console.log('👤 User Name:', req.user?.name);
  console.log('📦 Request Body:', JSON.stringify(req.body, null, 2));
  
  try {
    console.log('🔄 Fetching club from database...');
    const club = await Club.findById(req.params.id);
    
    if (!club) {
      console.error('❌ Club not found');
      console.log('========================================\n');
      return res.status(404).json({ 
        success: false, 
        message: 'Club not found',
        clubId: req.params.id
      });
    }

    console.log('✅ Club found:', club.name);
    console.log('📊 Club Info:', {
      name: club.name,
      type: club.type,
      requireApproval: club.requireApproval,
      membersCount: club.membersCount,
      maxMembers: club.maxMembers,
      isApproved: club.isApproved,
      isFlagged: club.isFlagged
    });

    // Check if already a member
    const isMember = club.isMember(req.user._id);
    console.log('👤 Is user already a member?', isMember);
    
    if (isMember) {
      console.warn('⚠️  User is already a member of this club');
      const memberInfo = club.members.find(m => m.user.toString() === req.user._id.toString());
      console.log('👤 Member Info:', {
        role: memberInfo?.role,
        joinedAt: memberInfo?.joinedAt,
        canPost: memberInfo?.canPost,
        isMuted: memberInfo?.isMuted
      });
      console.log('========================================\n');
      return res.status(400).json({ 
        success: false, 
        message: 'You are already a member',
        memberInfo: {
          role: memberInfo?.role,
          joinedAt: memberInfo?.joinedAt
        }
      });
    }

    // Check for existing join request
    const existingRequest = club.joinRequests.find(
      r => r.user.toString() === req.user._id.toString() && r.status === 'pending'
    );
    if (existingRequest) {
      console.warn('⚠️  User already has a pending join request');
      console.log('📋 Request Info:', {
        requestedAt: existingRequest.requestedAt,
        message: existingRequest.message
      });
      console.log('========================================\n');
      return res.status(400).json({
        success: false,
        message: 'You already have a pending join request',
        requestedAt: existingRequest.requestedAt
      });
    }

    // Check max members limit
    if (club.maxMembers && club.membersCount >= club.maxMembers) {
      console.warn('⚠️  Club has reached maximum member capacity');
      console.log('📊 Capacity:', `${club.membersCount}/${club.maxMembers}`);
      console.log('========================================\n');
      return res.status(400).json({
        success: false,
        message: 'This club has reached its maximum member capacity',
        maxMembers: club.maxMembers,
        currentMembers: club.membersCount
      });
    }

    const io = req.app.get('io');

    // Private clubs - can join with invite code OR send join request
    if (club.type === 'private') {
      console.log('🔒 Private club - checking invite code or creating join request...');
      const { inviteCode, message } = req.body;
      console.log('🔑 Provided invite code:', inviteCode ? '***' + inviteCode.slice(-2) : 'none');
      console.log('🔑 Required invite code:', club.inviteCode ? '***' + club.inviteCode.slice(-2) : 'none');
      console.log('💬 Join request message:', message || '(none)');
      
      if (inviteCode && inviteCode === club.inviteCode) {
        console.log('✅ Valid invite code - adding member directly');
        // Join directly with valid invite code
        club.addMember(req.user._id);
        await club.save();

        console.log('📊 Updated members count:', club.membersCount);

        // Notify club admins
        const admins = club.members.filter(m => m.role === 'owner' || m.role === 'admin');
        console.log('📧 Notifying', admins.length, 'admin(s)');
        
        admins.forEach(admin => {
          io.to(`user:${admin.user.toString()}`).emit('club:member-joined', {
            clubId: club._id.toString(),
            userId: req.user._id.toString(),
            userName: req.user.name
          });
        });

        console.log('✅ Successfully joined private club');
        console.log('========================================\n');
        return res.json({ 
          success: true, 
          message: 'Successfully joined club', 
          data: club,
          memberInfo: {
            role: 'member',
            joinedAt: new Date()
          }
        });
      } else {
        // No valid invite code - allow user to request to join
        console.log('🔑 No valid invite code - creating join request for private club');
        
        // Add join request
        const requestMessage = message || '';
        club.addJoinRequest(req.user._id, requestMessage);
        await club.save();

        console.log('✅ Join request created for private club');

        // Notify club admins and moderators
        const moderators = club.members.filter(m => 
          m.role === 'owner' || m.role === 'admin' || m.role === 'moderator'
        );
        
        console.log('📧 Notifying', moderators.length, 'moderator(s)');
        
        moderators.forEach(async (mod) => {
          io.to(`user:${mod.user.toString()}`).emit('club:join-request', {
            clubId: club._id.toString(),
            userId: req.user._id.toString(),
            userName: req.user.name,
            message: requestMessage,
            clubType: 'private'
          });

          // Create notification
          try {
            await Notification.create({
              recipient: mod.user,
              sender: req.user._id,
              type: 'club_join_request',
              content: `${req.user.name} wants to join ${club.name}`,
              relatedId: club._id,
              relatedModel: 'Club'
            });
          } catch (notifError) {
            console.error('⚠️  Failed to create notification:', notifError.message);
          }
        });

        console.log('✅ Join request sent successfully for private club');
        console.log('========================================\n');
        return res.json({ 
          success: true, 
          message: 'Join request sent to club admins', 
          requiresApproval: true,
          clubName: club.name,
          clubType: 'private'
        });
      }
    }

    // Public clubs
    console.log('🌐 Public club - checking approval requirement...');
    console.log('📋 Requires approval:', club.requireApproval);
    
    if (club.requireApproval) {
      console.log('✋ Approval required - creating join request');
      // Add join request
      const message = req.body.message || '';
      console.log('💬 Join request message:', message || '(none)');
      
      club.addJoinRequest(req.user._id, message);
      await club.save();

      console.log('✅ Join request created');

      // Notify club admins and moderators
      const moderators = club.members.filter(m => 
        m.role === 'owner' || m.role === 'admin' || m.role === 'moderator'
      );
      
      console.log('📧 Notifying', moderators.length, 'moderator(s)');
      
      moderators.forEach(async (mod) => {
        io.to(`user:${mod.user.toString()}`).emit('club:join-request', {
          clubId: club._id.toString(),
          userId: req.user._id.toString(),
          userName: req.user.name,
          message
        });

        // Create notification
        try {
          await Notification.create({
            recipient: mod.user,
            sender: req.user._id,
            type: 'club_join_request',
            content: `${req.user.name} wants to join ${club.name}`,
            relatedId: club._id,
            relatedModel: 'Club'
          });
        } catch (notifError) {
          console.error('⚠️  Failed to create notification:', notifError.message);
        }
      });

      console.log('✅ Join request sent successfully');
      console.log('========================================\n');
      return res.json({ 
        success: true, 
        message: 'Join request sent', 
        requiresApproval: true,
        clubName: club.name
      });
    } else {
      console.log('✅ No approval required - adding member directly');
      // Join directly
      club.addMember(req.user._id);
      await club.save();

      console.log('📊 Updated members count:', club.membersCount);

      // Check for achievements - club join
      try {
        const newAchievements = await achievementService.checkAndAwardAchievements(
          req.user._id,
          'club_join',
          { clubId: club._id }
        );
        if (newAchievements.length > 0) {
          console.log('🏆 New achievements unlocked:', newAchievements.map(a => a.achievement.name).join(', '));
        }
      } catch (achievementError) {
        console.error('⚠️  Achievement check failed:', achievementError.message);
      }

      // Notify club admins
      const admins = club.members.filter(m => m.role === 'owner' || m.role === 'admin');
      console.log('📧 Notifying', admins.length, 'admin(s)');
      
      admins.forEach(admin => {
        io.to(`user:${admin.user.toString()}`).emit('club:member-joined', {
          clubId: club._id.toString(),
          userId: req.user._id.toString(),
          userName: req.user.name
        });
      });

      console.log('✅ Successfully joined club');
      console.log('========================================\n');
      return res.json({ 
        success: true, 
        message: 'Successfully joined club', 
        data: club,
        memberInfo: {
          role: 'member',
          joinedAt: new Date()
        }
      });
    }
  } catch (error) {
    console.error('========================================');
    console.error('❌ JOIN CLUB ERROR');
    console.error('========================================');
    console.error('Error Name:', error.name);
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    console.error('Club ID:', req.params.id);
    console.error('User:', {
      id: req.user?._id,
      name: req.user?.name,
      email: req.user?.email
    });
    console.error('Request Body:', JSON.stringify(req.body, null, 2));
    
    // Check if it's a method error
    if (error.message && error.message.includes('addMember')) {
      console.error('⚠️  addMember method error - check Club model methods');
    }
    if (error.message && error.message.includes('addJoinRequest')) {
      console.error('⚠️  addJoinRequest method error - check Club model methods');
    }
    
    console.error('========================================\n');
    
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to join club',
      error: error.message,
      errorType: error.name,
      debug: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        clubId: req.params.id
      } : undefined
    });
  }
});

// Leave club
router.post('/:id/leave', checkSuspension, param('id').isMongoId(), async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Check if member
    if (!club.isMember(req.user._id)) {
      return res.status(400).json({ success: false, message: 'You are not a member' });
    }

    // Owner cannot leave their own club
    if (club.owner.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Club owner cannot leave. Transfer ownership or delete the club.' });
    }

    club.removeMember(req.user._id);
    await club.save();

    // Notify club admins
    const io = req.app.get('io');
    const admins = club.members.filter(m => m.role === 'owner' || m.role === 'admin');
    admins.forEach(admin => {
      io.to(`user:${admin.user.toString()}`).emit('club:member-left', {
        clubId: club._id.toString(),
        userId: req.user._id.toString(),
        userName: req.user.name
      });
    });

    return res.json({ success: true, message: 'Successfully left club' });
  } catch (error) {
    console.error('Leave club error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to leave club' });
  }
});

// Accept invite to join club
router.post('/:id/accept-invite', checkSuspension, param('id').isMongoId(), async (req, res) => {
  console.log('========================================');
  console.log('✅ ACCEPT INVITE TO CLUB REQUEST');
  console.log('========================================');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('🆔 Club ID:', req.params.id);
  console.log('👤 User ID:', req.user?._id);
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('❌ Validation errors:', errors.array());
      return res.status(400).json({ 
        success: false, 
        errors: errors.array(),
        message: 'Invalid club ID format'
      });
    }

    const club = await Club.findById(req.params.id);
    if (!club) {
      console.error('❌ Club not found');
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    console.log('✅ Club found:', club.name);

    // Check if already a member
    if (club.isMember(req.user._id)) {
      console.warn('⚠️  User is already a member');
      return res.status(400).json({ success: false, message: 'You are already a member' });
    }

    // Check max members limit
    if (club.maxMembers && club.membersCount >= club.maxMembers) {
      console.warn('⚠️  Club has reached maximum capacity');
      return res.status(400).json({
        success: false,
        message: 'This club has reached its maximum member capacity'
      });
    }

    // Add as member
    club.addMember(req.user._id);
    await club.save();

    console.log('📊 Updated members count:', club.membersCount);

    // Notify club admins
    const io = req.app.get('io');
    const admins = club.members.filter(m => m.role === 'owner' || m.role === 'admin');
    console.log('📧 Notifying', admins.length, 'admin(s)');
    
    admins.forEach(admin => {
      io.to(`user:${admin.user.toString()}`).emit('club:member-joined', {
        clubId: club._id.toString(),
        userId: req.user._id.toString(),
        userName: req.user.name
      });
    });

    console.log('✅ Successfully accepted invite and joined club');
    console.log('========================================\n');

    return res.json({ 
      success: true, 
      message: 'Successfully joined club', 
      data: club,
      memberInfo: {
        role: 'member',
        joinedAt: new Date()
      }
    });
  } catch (error) {
    console.error('========================================');
    console.error('❌ ACCEPT INVITE ERROR');
    console.error('========================================');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('========================================\n');
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to accept invite' 
    });
  }
});

// Approve join request
router.post('/:id/approve-request/:userId', checkSuspension, [
  param('id').isMongoId(),
  param('userId').isMongoId()
], async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Check if user can moderate
    if (!club.canModerate(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to approve requests' });
    }

    club.approveJoinRequest(req.params.userId, req.user._id);
    await club.save();

    // Notify the user
    const io = req.app.get('io');
    io.to(`user:${req.params.userId}`).emit('club:request-approved', {
      clubId: club._id.toString(),
      clubName: club.name
    });

    await Notification.create({
      recipient: req.params.userId,
      sender: req.user._id,
      type: 'club_request_approved',
      content: `Your request to join ${club.name} was approved`,
      relatedId: club._id,
      relatedModel: 'Club'
    });

    return res.json({ success: true, message: 'Join request approved' });
  } catch (error) {
    console.error('Approve request error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to approve request' });
  }
});

// Reject join request
router.post('/:id/reject-request/:userId', checkSuspension, [
  param('id').isMongoId(),
  param('userId').isMongoId()
], async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Check if user can moderate
    if (!club.canModerate(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to reject requests' });
    }

    club.rejectJoinRequest(req.params.userId, req.user._id);
    await club.save();

    // Notify the user
    const io = req.app.get('io');
    io.to(`user:${req.params.userId}`).emit('club:request-rejected', {
      clubId: club._id.toString(),
      clubName: club.name
    });

    await Notification.create({
      recipient: req.params.userId,
      sender: req.user._id,
      type: 'club_request_rejected',
      content: `Your request to join ${club.name} was declined`,
      relatedId: club._id,
      relatedModel: 'Club'
    });

    return res.json({ success: true, message: 'Join request rejected' });
  } catch (error) {
    console.error('Reject request error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to reject request' });
  }
});

// Invite user to club
router.post('/:id/invite/:userId', checkSuspension, [
  param('id').isMongoId(),
  param('userId').isMongoId()
], async (req, res) => {
  console.log('========================================');
  console.log('📧 INVITE USER TO CLUB REQUEST');
  console.log('========================================');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('🆔 Club ID:', req.params.id);
  console.log('👤 Inviter ID:', req.user?._id);
  console.log('👥 Invitee ID:', req.params.userId);
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('❌ Validation errors:', errors.array());
      return res.status(400).json({ 
        success: false, 
        errors: errors.array(),
        message: 'Invalid ID format'
      });
    }

    const club = await Club.findById(req.params.id);
    if (!club) {
      console.error('❌ Club not found');
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    console.log('✅ Club found:', club.name);

    // Check if inviter is a member and has permission to invite
    if (!club.isMember(req.user._id)) {
      console.error('❌ User is not a member of the club');
      return res.status(403).json({ success: false, message: 'You must be a member to invite others' });
    }

    // Check if club allows member invites or if user is moderator
    if (!club.allowMemberInvites && !club.canModerate(req.user._id)) {
      console.error('❌ Member invites are not allowed');
      return res.status(403).json({ 
        success: false, 
        message: 'Only moderators can invite members to this club' 
      });
    }

    // Check if invitee is already a member
    if (club.isMember(req.params.userId)) {
      console.warn('⚠️  User is already a member');
      return res.status(400).json({ success: false, message: 'User is already a member' });
    }

    // Check if invitee already has a pending join request
    const existingRequest = club.joinRequests.find(
      r => r.user.toString() === req.params.userId.toString() && r.status === 'pending'
    );
    if (existingRequest) {
      console.warn('⚠️  User already has a pending join request - auto-approving');
      // Auto-approve the existing request instead of sending invite
      club.approveJoinRequest(req.params.userId, req.user._id);
      await club.save();

      // Notify the user
      const io = req.app.get('io');
      io.to(`user:${req.params.userId}`).emit('club:request-approved', {
        clubId: club._id.toString(),
        clubName: club.name
      });

      await Notification.create({
        recipient: req.params.userId,
        sender: req.user._id,
        type: 'club_request_approved',
        content: `Your request to join ${club.name} was approved`,
        relatedId: club._id,
        relatedModel: 'Club'
      });

      console.log('✅ Join request auto-approved');
      return res.json({ success: true, message: 'User added to club' });
    }

    // Check max members limit
    if (club.maxMembers && club.membersCount >= club.maxMembers) {
      console.warn('⚠️  Club has reached maximum capacity');
      return res.status(400).json({
        success: false,
        message: 'This club has reached its maximum member capacity'
      });
    }

    // Send invite notification
    const io = req.app.get('io');
    io.to(`user:${req.params.userId}`).emit('club:invited', {
      clubId: club._id.toString(),
      clubName: club.name,
      inviterName: req.user.name,
      inviterId: req.user._id.toString()
    });

    await Notification.create({
      recipient: req.params.userId,
      sender: req.user._id,
      type: 'club_invite',
      content: `${req.user.name} invited you to join ${club.name}`,
      relatedId: club._id,
      relatedModel: 'Club'
    });

    console.log('✅ Invite sent successfully');
    console.log('========================================\n');

    return res.json({ 
      success: true, 
      message: 'Invite sent successfully',
      clubName: club.name 
    });
  } catch (error) {
    console.error('========================================');
    console.error('❌ INVITE USER ERROR');
    console.error('========================================');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('========================================\n');
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to send invite' 
    });
  }
});

// Get pending join requests (for moderators)
router.get('/:id/join-requests', param('id').isMongoId(), async (req, res) => {
  try {
    const club = await Club.findById(req.params.id)
      .populate('joinRequests.user', 'name avatar isVerified');

    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Check if user can moderate
    if (!club.canModerate(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to view requests' });
    }

    const pendingRequests = club.joinRequests.filter(r => r.status === 'pending');

    return res.json({ success: true, data: pendingRequests });
  } catch (error) {
    console.error('Get join requests error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch join requests' });
  }
});

// ===== MEMBER MANAGEMENT =====

// Get club members
router.get('/:id/members', param('id').isMongoId(), async (req, res) => {
  console.log('========================================');
  console.log('👥 GET CLUB MEMBERS REQUEST');
  console.log('========================================');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('🆔 Club ID:', req.params.id);
  console.log('👤 User ID:', req.user?._id);
  console.log('👤 User Name:', req.user?.name);
  
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('❌ Get members validation error: Invalid club ID format');
      console.error('Provided ID:', req.params.id);
      console.log('========================================\n');
      return res.status(400).json({ 
        success: false, 
        errors: errors.array(),
        message: 'Invalid club ID format'
      });
    }

    console.log('✅ Validation passed, fetching club...');
    const club = await Club.findById(req.params.id)
      .populate({
        path: 'members.user',
        select: 'name avatar isVerified isOnline lastActive'
      });

    if (!club) {
      console.warn('⚠️  Club not found');
      console.log('========================================\n');
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    console.log(`✅ Club found: ${club.name}`);
    console.log(`👥 Members count: ${club.members.length}`);

    // Check if user is a member (for private clubs)
    if (club.type === 'private' && !club.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You must be a member to view members' });
    }

    // Format members data with online status
    const members = club.members.map(member => ({
      user: {
        _id: member.user._id,
        name: member.user.name,
        avatar: member.user.avatar,
        isVerified: member.user.isVerified,
        isOnline: member.user.isOnline,
        lastActive: member.user.lastActive
      },
      role: member.role,
      joinedAt: member.joinedAt,
      canPost: member.canPost,
      canComment: member.canComment,
      isMuted: member.isMuted,
      mutedUntil: member.mutedUntil
    }));

    console.log(`✅ Returning ${members.length} members`);
    console.log('========================================\n');

    return res.json({ 
      success: true, 
      members,
      total: members.length 
    });
  } catch (error) {
    console.error('========================================');
    console.error('❌ GET CLUB MEMBERS ERROR');
    console.error('========================================');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('========================================\n');
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch members' });
  }
});

// Remove member
router.delete('/:id/members/:userId', checkSuspension, [
  param('id').isMongoId(),
  param('userId').isMongoId()
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array(),
        message: 'Invalid ID format'
      });
    }

    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Check if user can manage
    if (!club.canManage(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to remove members' });
    }

    club.removeMember(req.params.userId);
    await club.save();

    // Notify the removed user
    const io = req.app.get('io');
    io.to(`user:${req.params.userId}`).emit('club:removed', {
      clubId: club._id.toString(),
      clubName: club.name
    });

    await Notification.create({
      recipient: req.params.userId,
      sender: req.user._id,
      type: 'club_removed',
      content: `You were removed from ${club.name}`,
      relatedId: club._id,
      relatedModel: 'Club'
    });

    return res.json({ success: true, message: 'Member removed successfully' });
  } catch (error) {
    console.error('Remove member error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to remove member' });
  }
});

// Update member role
router.patch('/:id/members/:userId/role', checkSuspension, [
  param('id').isMongoId(),
  param('userId').isMongoId(),
  body('role').isIn(['admin', 'moderator', 'member'])
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array(),
        message: 'Invalid parameters'
      });
    }

    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Only owner can change roles
    if (club.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the club owner can change roles' });
    }

    club.updateMemberRole(req.params.userId, req.body.role);
    await club.save();

    // Notify the user
    const io = req.app.get('io');
    io.to(`user:${req.params.userId}`).emit('club:role-updated', {
      clubId: club._id.toString(),
      clubName: club.name,
      newRole: req.body.role
    });

    await Notification.create({
      recipient: req.params.userId,
      sender: req.user._id,
      type: 'club_role_updated',
      content: `Your role in ${club.name} was changed to ${req.body.role}`,
      relatedId: club._id,
      relatedModel: 'Club'
    });

    return res.json({ success: true, message: 'Member role updated' });
  } catch (error) {
    console.error('Update member role error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to update role' });
  }
});

// Mute member
router.post('/:id/members/:userId/mute', checkSuspension, [
  param('id').isMongoId(),
  param('userId').isMongoId(),
  body('duration').optional().isInt({ min: 1 })
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array(),
        message: 'Invalid parameters'
      });
    }

    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Check if user can moderate
    if (!club.canModerate(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to mute members' });
    }

    const duration = req.body.duration ? req.body.duration * 60 * 60 * 1000 : null; // hours to ms
    club.muteMember(req.params.userId, duration);
    await club.save();

    // Notify the user
    const io = req.app.get('io');
    io.to(`user:${req.params.userId}`).emit('club:muted', {
      clubId: club._id.toString(),
      clubName: club.name,
      duration: req.body.duration
    });

    return res.json({ success: true, message: 'Member muted successfully' });
  } catch (error) {
    console.error('Mute member error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to mute member' });
  }
});

// Unmute member
router.post('/:id/members/:userId/unmute', checkSuspension, [
  param('id').isMongoId(),
  param('userId').isMongoId()
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array(),
        message: 'Invalid ID format'
      });
    }

    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Check if user can moderate
    if (!club.canModerate(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to unmute members' });
    }

    club.unmuteMember(req.params.userId);
    await club.save();

    // Notify the user
    const io = req.app.get('io');
    io.to(`user:${req.params.userId}`).emit('club:unmuted', {
      clubId: club._id.toString(),
      clubName: club.name
    });

    return res.json({ success: true, message: 'Member unmuted successfully' });
  } catch (error) {
    console.error('Unmute member error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to unmute member' });
  }
});

// ===== DISCUSSIONS =====

// Create discussion post
router.post('/:id/discussions', checkSuspension, upload.array('media', 10), [
  param('id').isMongoId(),
  body('content')
    .optional({ checkFalsy: true })  // Allow empty/falsy values
    .trim()
    .isLength({ max: 5000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Process uploaded media files
    const media = [];
    if (req.files && req.files.length > 0) {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      for (const file of req.files) {
        const mediaItem = {
          url: `${baseUrl}/${file.path.replace(/\\/g, '/')}`,
          type: file.mimetype.startsWith('video/') ? 'video' : 'image',
          thumbnail: null, // TODO: Generate video thumbnails
          width: null, // TODO: Extract image/video dimensions
          height: null,
          duration: null // TODO: Extract video duration
        };
        media.push(mediaItem);
      }
    }

    // Validate that either content or media is provided
    const content = req.body.content ? req.body.content.trim() : '';
    if (!content && media.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Either content or media must be provided' 
      });
    }

    // Parse poll options if provided
    let pollOptions = null;
    if (req.body.pollOptions) {
      try {
        pollOptions = typeof req.body.pollOptions === 'string' 
          ? JSON.parse(req.body.pollOptions) 
          : req.body.pollOptions;
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid poll options format' });
      }
    }

    // Parse tagged members if provided
    let taggedMembers = [];
    if (req.body.taggedMembers) {
      try {
        taggedMembers = typeof req.body.taggedMembers === 'string'
          ? JSON.parse(req.body.taggedMembers)
          : req.body.taggedMembers;
        
        // Validate tagged members are club members
        if (Array.isArray(taggedMembers)) {
          for (const userId of taggedMembers) {
            if (!club.isMember(userId)) {
              return res.status(400).json({ 
                success: false, 
                message: `User ${userId} is not a member of this club` 
              });
            }
          }
        } else {
          taggedMembers = [];
        }
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid taggedMembers format' });
      }
    }

    const discussion = club.addDiscussion(
      req.user._id,
      content,
      req.body.type || 'discussion',
      media,
      pollOptions,
      req.body.pollEndsAt ? new Date(req.body.pollEndsAt) : null
    );

    // Add tagged members to discussion
    if (taggedMembers.length > 0) {
      discussion.taggedMembers = taggedMembers;
    }

    await club.save();

    // Check for achievements - club post
    try {
      const isEarlyPost = club.createdAt && (Date.now() - club.createdAt.getTime()) < (60 * 60 * 1000); // Within 1 hour
      const newAchievements = await achievementService.checkAndAwardAchievements(
        req.user._id,
        'club_post',
        { clubId: club._id, isEarlyPost }
      );
      if (newAchievements.length > 0) {
        console.log('🏆 New achievements unlocked:', newAchievements.map(a => a.achievement.name).join(', '));
      }
    } catch (achievementError) {
      console.error('⚠️  Achievement check failed:', achievementError.message);
    }

    // Populate author info
    await club.populate('discussions.author', 'name avatar isVerified');

    // Get the populated discussion - find it by ID since the reference isn't updated
    const populatedDiscussion = club.discussions.id(discussion._id);

    // Create notifications for club members
    const io = req.app.get('io');
    for (const member of club.members) {
      if (member.user.toString() !== req.user._id.toString()) {
        // Send socket notification
        io.to(`user:${member.user.toString()}`).emit('club:new-discussion', {
          clubId: club._id.toString(),
          clubName: club.name,
          discussionId: discussion._id.toString(),
          authorName: req.user.name,
          authorAvatar: req.user.avatar,
          type: discussion.type,
          hasMedia: media.length > 0
        });

        // Create in-app notification
        try {
          await Notification.create({
            recipient: member.user,
            sender: req.user._id,
            type: 'club_post',
            content: `${req.user.name} posted in ${club.name}`,
            relatedId: club._id,
            relatedModel: 'Club',
            actionUrl: `/clubs/${club._id}/discussions/${discussion._id}`
          });
        } catch (notifError) {
          console.error('Error creating notification:', notifError);
        }
      }
    }

    // Send separate notifications for tagged members
    for (const taggedUserId of taggedMembers) {
      if (taggedUserId.toString() !== req.user._id.toString()) {
        // Send socket notification
        io.to(`user:${taggedUserId.toString()}`).emit('club:discussion-tag', {
          clubId: club._id.toString(),
          clubName: club.name,
          discussionId: discussion._id.toString(),
          authorName: req.user.name,
          authorAvatar: req.user.avatar
        });

        // Create in-app notification for tag (in addition to general post notification)
        try {
          await Notification.create({
            recipient: taggedUserId,
            sender: req.user._id,
            type: 'club_discussion_tag',
            content: `${req.user.name} tagged you in a post in ${club.name}`,
            relatedId: club._id,
            relatedModel: 'Club',
            actionUrl: `/clubs/${club._id}/discussions/${discussion._id}`
          });
        } catch (notifError) {
          console.error('Error creating tag notification:', notifError);
        }
      }
    }

    return res.status(201).json({ success: true, data: populatedDiscussion });
  } catch (error) {
    console.error('Create discussion error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to create discussion' });
  }
});

// Get club discussions
router.get('/:id/discussions', param('id').isMongoId(), async (req, res) => {
  try {
    const { page = 1, limit = 20, sort = 'recent' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const club = await Club.findById(req.params.id)
      .populate('discussions.author', 'name avatar isVerified');

    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Check access
    if (club.type === 'private' && !club.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Filter and sort discussions
    let discussions = club.discussions.filter(d => !d.isDeleted);

    if (sort === 'recent') {
      discussions.sort((a, b) => b.createdAt - a.createdAt);
    } else if (sort === 'popular') {
      discussions.sort((a, b) => b.likesCount - a.likesCount);
    }

    // Pinned posts first
    const pinnedDiscussions = discussions.filter(d => d.isPinned);
    const regularDiscussions = discussions.filter(d => !d.isPinned);
    discussions = [...pinnedDiscussions, ...regularDiscussions];

    const total = discussions.length;
    const paginatedDiscussions = discussions.slice(skip, skip + parseInt(limit));

    return res.json({
      success: true,
      data: {
        discussions: paginatedDiscussions,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get discussions error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch discussions' });
  }
});

// Like discussion
router.post('/:id/discussions/:discussionId/like', checkSuspension, [
  param('id').isMongoId(),
  param('discussionId').isMongoId()
], async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    if (!club.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You must be a member to like posts' });
    }

    const discussion = club.discussions.id(req.params.discussionId);
    if (!discussion || discussion.isDeleted) {
      return res.status(404).json({ success: false, message: 'Discussion not found' });
    }

    const userIdStr = req.user._id.toString();
    const likeIndex = discussion.likes.findIndex(id => id.toString() === userIdStr);

    if (likeIndex > -1) {
      // Unlike
      discussion.likes.splice(likeIndex, 1);
      discussion.likesCount = discussion.likes.length;
    } else {
      // Like
      discussion.likes.push(req.user._id);
      discussion.likesCount = discussion.likes.length;

      // Check for achievements - like given
      try {
        await achievementService.checkAndAwardAchievements(
          req.user._id,
          'club_like_given',
          { clubId: club._id }
        );
      } catch (achievementError) {
        console.error('⚠️  Achievement check failed:', achievementError.message);
      }

      // Check for achievements - like received (for post author)
      try {
        await achievementService.checkAndAwardAchievements(
          discussion.author.toString(),
          'club_like_received',
          { clubId: club._id }
        );
      } catch (achievementError) {
        console.error('⚠️  Achievement check failed:', achievementError.message);
      }

      // Notify author
      if (discussion.author.toString() !== req.user._id.toString()) {
        const io = req.app.get('io');
        io.to(`user:${discussion.author.toString()}`).emit('club:discussion-liked', {
          clubId: club._id.toString(),
          discussionId: discussion._id.toString(),
          userName: req.user.name
        });
      }
    }

    await club.save();

    return res.json({ success: true, liked: likeIndex === -1, likesCount: discussion.likesCount });
  } catch (error) {
    console.error('Like discussion error:', error);
    return res.status(500).json({ success: false, message: 'Failed to like discussion' });
  }
});

// Delete discussion
router.delete('/:id/discussions/:discussionId', checkSuspension, [
  param('id').isMongoId(),
  param('discussionId').isMongoId()
], async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    const discussion = club.discussions.id(req.params.discussionId);
    if (!discussion) {
      return res.status(404).json({ success: false, message: 'Discussion not found' });
    }

    // Check if user is author or moderator
    const isAuthor = discussion.author.toString() === req.user._id.toString();
    const canModerate = club.canModerate(req.user._id);

    if (!isAuthor && !canModerate) {
      return res.status(403).json({ success: false, message: 'You do not have permission to delete this discussion' });
    }

    discussion.isDeleted = true;
    discussion.deletedBy = req.user._id;
    discussion.deletedAt = new Date();
    club.discussionsCount = club.discussions.filter(d => !d.isDeleted).length;

    await club.save();

    return res.json({ success: true, message: 'Discussion deleted successfully' });
  } catch (error) {
    console.error('Delete discussion error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete discussion' });
  }
});

// Edit discussion
router.put('/:id/discussions/:discussionId', checkSuspension, upload.array('media', 10), [
  param('id').isMongoId(),
  param('discussionId').isMongoId(),
  body('content')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 5000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    const discussion = club.discussions.id(req.params.discussionId);
    if (!discussion || discussion.isDeleted) {
      return res.status(404).json({ success: false, message: 'Discussion not found' });
    }

    // Check if user is author or moderator
    const isAuthor = discussion.author.toString() === req.user._id.toString();
    const canModerate = club.canModerate(req.user._id);

    if (!isAuthor && !canModerate) {
      return res.status(403).json({ success: false, message: 'You do not have permission to edit this discussion' });
    }

    // Prepare updates object
    const updates = {};

    // Only author can edit content and media
    if (isAuthor) {
      // Handle content update
      if (req.body.content !== undefined) {
        updates.content = req.body.content.trim();
      }

      // Handle media update
      if (req.files && req.files.length > 0) {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        updates.media = req.files.map(file => ({
          url: `${baseUrl}/${file.path.replace(/\\/g, '/')}`,
          type: file.mimetype.startsWith('video/') ? 'video' : 'image',
          thumbnail: null,
          width: null,
          height: null,
          duration: null
        }));
      } else if (req.body.media) {
        // If media is sent as JSON (for removing media)
        try {
          updates.media = typeof req.body.media === 'string' 
            ? JSON.parse(req.body.media) 
            : req.body.media;
        } catch (e) {
          return res.status(400).json({ success: false, message: 'Invalid media format' });
        }
      }

      // Handle tagged members update
      if (req.body.taggedMembers) {
        try {
          const taggedMembers = typeof req.body.taggedMembers === 'string'
            ? JSON.parse(req.body.taggedMembers)
            : req.body.taggedMembers;
          
          // Validate tagged members are club members
          if (Array.isArray(taggedMembers)) {
            for (const userId of taggedMembers) {
              if (!club.isMember(userId)) {
                return res.status(400).json({ 
                  success: false, 
                  message: `User ${userId} is not a member of this club` 
                });
              }
            }
            updates.taggedMembers = taggedMembers;
          }
        } catch (e) {
          return res.status(400).json({ success: false, message: 'Invalid taggedMembers format' });
        }
      }

      // Validate that either content or media exists after update
      const finalContent = updates.content !== undefined ? updates.content : discussion.content;
      const finalMedia = updates.media !== undefined ? updates.media : discussion.media;
      
      if (!finalContent && (!finalMedia || finalMedia.length === 0)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Either content or media must be provided' 
        });
      }
    }

    // Update the discussion using the model method
    const updatedDiscussion = club.updateDiscussion(req.params.discussionId, req.user._id, updates);

    await club.save();
    await club.populate('discussions.author', 'name avatar isVerified');

    // Notify tagged members (only for new tags)
    const io = req.app.get('io');
    if (updates.taggedMembers && isAuthor) {
      const previouslyTagged = discussion.taggedMembers || [];
      const newlyTagged = updates.taggedMembers.filter(
        userId => !previouslyTagged.some(prevId => prevId.toString() === userId.toString())
      );

      for (const taggedUserId of newlyTagged) {
        if (taggedUserId.toString() !== req.user._id.toString()) {
          // Send socket notification
          io.to(`user:${taggedUserId.toString()}`).emit('club:discussion-tag', {
            clubId: club._id.toString(),
            clubName: club.name,
            discussionId: updatedDiscussion._id.toString(),
            authorName: req.user.name,
            authorAvatar: req.user.avatar
          });

          // Create in-app notification
          try {
            await Notification.create({
              recipient: taggedUserId,
              sender: req.user._id,
              type: 'club_discussion_tag',
              content: `${req.user.name} tagged you in a post in ${club.name}`,
              relatedId: club._id,
              relatedModel: 'Club',
              actionUrl: `/clubs/${club._id}/discussions/${updatedDiscussion._id}`
            });
          } catch (notifError) {
            console.error('Error creating tag notification:', notifError);
          }
        }
      }
    }

    return res.json({ success: true, data: updatedDiscussion });
  } catch (error) {
    console.error('Edit discussion error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to edit discussion' });
  }
});

// Pin/Unpin discussion
router.post('/:id/discussions/:discussionId/pin', checkSuspension, [
  param('id').isMongoId(),
  param('discussionId').isMongoId()
], async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    if (!club.canModerate(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to pin posts' });
    }

    const discussion = club.discussions.id(req.params.discussionId);
    if (!discussion || discussion.isDeleted) {
      return res.status(404).json({ success: false, message: 'Discussion not found' });
    }

    discussion.isPinned = !discussion.isPinned;
    await club.save();

    return res.json({ success: true, isPinned: discussion.isPinned });
  } catch (error) {
    console.error('Pin discussion error:', error);
    return res.status(500).json({ success: false, message: 'Failed to pin discussion' });
  }
});

// Vote on poll
router.post('/:id/discussions/:discussionId/vote', checkSuspension, [
  param('id').isMongoId(),
  param('discussionId').isMongoId(),
  body('optionIndex').isInt({ min: 0 })
], async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    if (!club.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You must be a member to vote' });
    }

    const discussion = club.discussions.id(req.params.discussionId);
    if (!discussion || discussion.isDeleted || discussion.type !== 'poll') {
      return res.status(404).json({ success: false, message: 'Poll not found' });
    }

    // Check if poll has ended
    if (discussion.pollEndsAt && new Date() > discussion.pollEndsAt) {
      return res.status(400).json({ success: false, message: 'Poll has ended' });
    }

    const optionIndex = req.body.optionIndex;
    if (optionIndex >= discussion.pollOptions.length) {
      return res.status(400).json({ success: false, message: 'Invalid option' });
    }

    const userIdStr = req.user._id.toString();

    // Remove previous vote if exists
    discussion.pollOptions.forEach(option => {
      const voteIndex = option.votes.findIndex(id => id.toString() === userIdStr);
      if (voteIndex > -1) {
        option.votes.splice(voteIndex, 1);
        option.votesCount = option.votes.length;
      }
    });

    // Add new vote
    discussion.pollOptions[optionIndex].votes.push(req.user._id);
    discussion.pollOptions[optionIndex].votesCount = discussion.pollOptions[optionIndex].votes.length;

    await club.save();

    return res.json({ success: true, data: discussion.pollOptions });
  } catch (error) {
    console.error('Vote on poll error:', error);
    return res.status(500).json({ success: false, message: 'Failed to vote' });
  }
});

// ===== COMMENTS =====

// Create comment on discussion
router.post('/:id/discussions/:discussionId/comments', checkSuspension, [
  param('id').isMongoId(),
  param('discussionId').isMongoId(),
  body('content').trim().notEmpty().isLength({ max: 2000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    const discussion = club.discussions.id(req.params.discussionId);
    if (!discussion || discussion.isDeleted) {
      return res.status(404).json({ success: false, message: 'Discussion not found' });
    }

    const comment = club.addComment(
      req.params.discussionId,
      req.user._id,
      req.body.content
    );

    await club.save();

    // Check for achievements - club comment
    try {
      const newAchievements = await achievementService.checkAndAwardAchievements(
        req.user._id,
        'club_comment',
        { clubId: club._id, discussionId: req.params.discussionId }
      );
      if (newAchievements.length > 0) {
        console.log('🏆 New achievements unlocked:', newAchievements.map(a => a.achievement.name).join(', '));
      }
    } catch (achievementError) {
      console.error('⚠️  Achievement check failed:', achievementError.message);
    }

    // Populate comment author info
    await club.populate('comments.author', 'name avatar isVerified');

    const populatedComment = club.comments.id(comment._id);

    // Notify discussion author and other commenters
    const io = req.app.get('io');
    
    // Notify discussion author
    if (discussion.author.toString() !== req.user._id.toString()) {
      io.to(`user:${discussion.author.toString()}`).emit('club:new-comment', {
        clubId: club._id.toString(),
        clubName: club.name,
        discussionId: discussion._id.toString(),
        commentId: comment._id.toString(),
        authorName: req.user.name,
        authorAvatar: req.user.avatar
      });

      // Create in-app notification
      try {
        await Notification.create({
          recipient: discussion.author,
          type: 'club_comment',
          content: `${req.user.name} commented on your post in ${club.name}`,
          relatedUser: req.user._id,
          relatedClub: club._id,
          relatedDiscussion: discussion._id,
          actionUrl: `/clubs/${club._id}/discussions/${discussion._id}`
        });
      } catch (notifError) {
        console.error('Error creating notification:', notifError);
      }
    }

    // Notify other unique commenters (excluding author and current user)
    const uniqueCommenters = new Set();
    club.comments
      .filter(c => 
        c.discussionId.toString() === req.params.discussionId &&
        !c.isDeleted &&
        c.author.toString() !== req.user._id.toString() &&
        c.author.toString() !== discussion.author.toString()
      )
      .forEach(c => uniqueCommenters.add(c.author.toString()));

    for (const commenterId of uniqueCommenters) {
      io.to(`user:${commenterId}`).emit('club:new-comment', {
        clubId: club._id.toString(),
        clubName: club.name,
        discussionId: discussion._id.toString(),
        commentId: comment._id.toString(),
        authorName: req.user.name,
        authorAvatar: req.user.avatar
      });

      try {
        await Notification.create({
          recipient: commenterId,
          type: 'club_comment',
          content: `${req.user.name} also commented on a post in ${club.name}`,
          relatedUser: req.user._id,
          relatedClub: club._id,
          relatedDiscussion: discussion._id,
          actionUrl: `/clubs/${club._id}/discussions/${discussion._id}`
        });
      } catch (notifError) {
        console.error('Error creating notification:', notifError);
      }
    }

    return res.status(201).json({ success: true, data: populatedComment });
  } catch (error) {
    console.error('Create comment error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to create comment' });
  }
});

// Get comments for discussion
router.get('/:id/discussions/:discussionId/comments', [
  param('id').isMongoId(),
  param('discussionId').isMongoId()
], async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const club = await Club.findById(req.params.id)
      .populate('comments.author', 'name avatar isVerified');

    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Check access
    if (club.type === 'private' && !club.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const discussion = club.discussions.id(req.params.discussionId);
    if (!discussion || discussion.isDeleted) {
      return res.status(404).json({ success: false, message: 'Discussion not found' });
    }

    // Get comments for this discussion
    const allComments = club.comments
      .filter(c => c.discussionId.toString() === req.params.discussionId && !c.isDeleted)
      .sort((a, b) => a.createdAt - b.createdAt); // Oldest first

    const total = allComments.length;
    const paginatedComments = allComments.slice(skip, skip + parseInt(limit));

    return res.json({
      success: true,
      data: {
        comments: paginatedComments,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get comments error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch comments' });
  }
});

// Like comment
router.post('/:id/comments/:commentId/like', checkSuspension, [
  param('id').isMongoId(),
  param('commentId').isMongoId()
], async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    if (!club.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You must be a member to like comments' });
    }

    const comment = club.comments.id(req.params.commentId);
    if (!comment || comment.isDeleted) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    const userIdStr = req.user._id.toString();
    const likeIndex = comment.likes.findIndex(id => id.toString() === userIdStr);

    if (likeIndex > -1) {
      // Unlike
      comment.likes.splice(likeIndex, 1);
      comment.likesCount = comment.likes.length;
    } else {
      // Like
      comment.likes.push(req.user._id);
      comment.likesCount = comment.likes.length;

      // Notify comment author
      if (comment.author.toString() !== req.user._id.toString()) {
        const io = req.app.get('io');
        io.to(`user:${comment.author.toString()}`).emit('club:comment-liked', {
          clubId: club._id.toString(),
          commentId: comment._id.toString(),
          userName: req.user.name
        });
      }
    }

    await club.save();

    return res.json({ success: true, liked: likeIndex === -1, likesCount: comment.likesCount });
  } catch (error) {
    console.error('Like comment error:', error);
    return res.status(500).json({ success: false, message: 'Failed to like comment' });
  }
});

// Delete comment
router.delete('/:id/comments/:commentId', checkSuspension, [
  param('id').isMongoId(),
  param('commentId').isMongoId()
], async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    const comment = club.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    // Check if user is author or moderator
    const isAuthor = comment.author.toString() === req.user._id.toString();
    const canModerate = club.canModerate(req.user._id);

    if (!isAuthor && !canModerate) {
      return res.status(403).json({ success: false, message: 'You do not have permission to delete this comment' });
    }

    comment.isDeleted = true;
    comment.deletedBy = req.user._id;
    comment.deletedAt = new Date();

    // Update discussion comment count
    const discussion = club.discussions.id(comment.discussionId);
    if (discussion) {
      discussion.commentsCount = club.comments.filter(
        c => c.discussionId.toString() === comment.discussionId.toString() && !c.isDeleted
      ).length;
    }

    await club.save();

    return res.json({ success: true, message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Delete comment error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete comment' });
  }
});

// ===== FILES =====

// Upload file
router.post('/:id/files', checkSuspension, param('id').isMongoId(), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    if (!club.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You must be a member to upload files' });
    }

    const fileType = req.file.mimetype.startsWith('image/') ? 'image' :
                     req.file.mimetype.startsWith('video/') ? 'video' :
                     req.file.mimetype.startsWith('audio/') ? 'audio' :
                     req.file.mimetype === 'application/pdf' ? 'document' : 'other';

    const fileData = {
      fileName: req.file.originalname,
      fileUrl: `/uploads/clubs/${req.file.filename}`,
      fileType,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      description: req.body.description || ''
    };

    const file = club.addFile(req.user._id, fileData);
    await club.save();

    // Notify club members
    const io = req.app.get('io');
    club.members.forEach(member => {
      if (member.user.toString() !== req.user._id.toString()) {
        io.to(`user:${member.user.toString()}`).emit('club:new-file', {
          clubId: club._id.toString(),
          clubName: club.name,
          fileName: file.fileName,
          uploaderName: req.user.name
        });
      }
    });

    return res.status(201).json({ success: true, data: file });
  } catch (error) {
    console.error('Upload file error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to upload file' });
  }
});

// Get club files
router.get('/:id/files', param('id').isMongoId(), async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const club = await Club.findById(req.params.id)
      .populate('files.uploadedBy', 'name avatar');

    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    // Check access
    if (club.type === 'private' && !club.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    let files = club.files;

    // Filter by type
    if (type && type !== 'all') {
      files = files.filter(f => f.fileType === type);
    }

    // Sort by upload date (newest first)
    files.sort((a, b) => b.uploadedAt - a.uploadedAt);

    const total = files.length;
    const paginatedFiles = files.slice(skip, skip + parseInt(limit));

    return res.json({
      success: true,
      data: {
        files: paginatedFiles,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get files error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch files' });
  }
});

// Delete file
router.delete('/:id/files/:fileId', checkSuspension, [
  param('id').isMongoId(),
  param('fileId').isMongoId()
], async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    const file = club.files.id(req.params.fileId);
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    // Check if user is uploader or moderator
    const isUploader = file.uploadedBy.toString() === req.user._id.toString();
    const canModerate = club.canModerate(req.user._id);

    if (!isUploader && !canModerate) {
      return res.status(403).json({ success: false, message: 'You do not have permission to delete this file' });
    }

    // Delete file from filesystem
    const filePath = path.join(__dirname, '..', file.fileUrl);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    file.remove();
    club.filesCount = club.files.length;
    await club.save();

    return res.json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete file error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete file' });
  }
});

// @route   POST /api/clubs/:id/report
// @desc    Report a club
// @access  Private
router.post('/:id/report', checkSuspension, [
  param('id').isMongoId(),
  body('reason')
    .notEmpty()
    .withMessage('Report reason is required')
    .isIn(['spam', 'harassment', 'hate_speech', 'violence', 'misinformation', 'inappropriate', 'other'])
    .withMessage('Invalid report reason'),
  body('details')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Report details cannot exceed 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const club = await Club.findById(req.params.id).populate('owner', 'name email');

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    const { reason, details } = req.body;

    // Save report to database
    const Report = require('../models/Report');
    const report = new Report({
      reportType: 'club',
      reportedClub: req.params.id,
      reporter: req.user._id,
      reason,
      details: details || '',
      status: 'pending'
    });
    await report.save();

    console.log(`🚨 Club report saved to database`);
    console.log(`   Report ID: ${report._id}`);
    console.log(`   Club ID: ${req.params.id}`);
    console.log(`   Club Name: ${club.name}`);
    console.log(`   Club Owner: ${club.owner?.name || 'Unknown'}`);
    console.log(`   Reporter: ${req.user.name} (${req.user._id})`);
    console.log(`   Reason: ${reason}`);
    if (details) {
      console.log(`   Details: ${details}`);
    }

    res.status(200).json({
      success: true,
      message: 'Report submitted successfully. Our team will review it shortly.',
      data: {
        reportId: report._id
      }
    });
  } catch (error) {
    console.error('Report club error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit report'
    });
  }
});

module.exports = router;
