const express = require('express');
const { body, validationResult } = require('express-validator');
const Photo = require('../models/Photo');
const { authenticateToken } = require('../middleware/auth');
const upload = require('../config/multer');
const { 
  createContentLimiter, 
  generalLimiter 
} = require('../middleware/rateLimiter');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Apply general rate limiting to all routes
router.use(generalLimiter);

// @route   POST /api/photos
// @desc    Upload a new photo
// @access  Private
router.post('/', createContentLimiter, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Photo file is required'
      });
    }

    const { caption, visibility, tags } = req.body;
    
    // Validate file type
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: 'File must be an image'
      });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    
    // Parse tags if provided
    let parsedTags = [];
    if (tags) {
      try {
        parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
        if (!Array.isArray(parsedTags)) {
          parsedTags = [];
        }
      } catch (e) {
        console.error('Error parsing tags:', e);
        parsedTags = [];
      }
    }

    const photo = new Photo({
      owner: req.user._id,
      imageUrl,
      caption: caption || '',
      visibility: visibility || 'followers',
      tags: parsedTags,
      metadata: {
        fileSize: req.file.size,
        mimeType: req.file.mimetype
      }
    });

    await photo.save();
    await photo.populate('owner', 'name email avatar');

    // Emit Socket.IO event for new photo
    const io = req.app.get('io');
    if (io) {
      // Get the owner's followers
      const User = require('../models/User');
      const owner = await User.findById(req.user._id).select('followers');
      const followerIds = owner.followers || [];
      
      // Emit to each follower individually
      followerIds.forEach(followerId => {
        io.to(`user:${followerId}`).emit('photo:created', {
          photo: photo.toObject(),
          owner: req.user._id
        });
      });
      
      console.log(`📸 Emitted photo:created to ${followerIds.length} followers`);
    }

    res.status(201).json({
      success: true,
      message: 'Photo uploaded successfully',
      data: { photo }
    });
  } catch (error) {
    console.error('Upload photo error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload photo',
      error: error.message
    });
  }
});

// @route   GET /api/photos/user/:userId
// @desc    Get photos by specific user (visible to followers)
// @access  Private
router.get('/user/:userId', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check if current user follows the target user or is viewing own photos
    const User = require('../models/User');
    const currentUser = await User.findById(req.user._id).select('following');
    
    const isOwnPhotos = req.user._id.toString() === req.params.userId.toString();
    const isFollowing = currentUser.following.some(id => 
      id.toString() === req.params.userId.toString()
    );

    if (!isOwnPhotos && !isFollowing) {
      return res.status(403).json({
        success: false,
        message: 'You can only view photos from users you follow'
      });
    }

    // Check for block relationship
    const Block = require('../models/Block');
    const isBlocked = await Block.isBlocked(req.user._id, req.params.userId);
    
    if (isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Cannot view photos from this user'
      });
    }

    // Build query based on visibility and relationship
    let visibilityQuery;
    if (isOwnPhotos) {
      // Own photos - show all
      visibilityQuery = {};
    } else if (isFollowing) {
      // Follower - show public and followers
      visibilityQuery = { visibility: { $in: ['public', 'followers'] } };
    } else {
      // Not following - show only public
      visibilityQuery = { visibility: 'public' };
    }

    const photos = await Photo.find({
      owner: req.params.userId,
      ...visibilityQuery
    })
      .populate('owner', 'name email avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const total = await Photo.countDocuments({
      owner: req.params.userId,
      ...visibilityQuery
    });

    res.status(200).json({
      success: true,
      message: 'Photos retrieved successfully',
      data: {
        photos,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get user photos error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve photos'
    });
  }
});

// @route   GET /api/photos/:id
// @desc    Get single photo by ID
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const photo = await Photo.findById(req.params.id)
      .populate('owner', 'name email avatar');

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: 'Photo not found'
      });
    }

    // Check if user has permission to view this photo
    const isOwner = photo.owner._id.toString() === req.user._id.toString();
    
    if (!isOwner) {
      // Check if user follows the owner
      const User = require('../models/User');
      const currentUser = await User.findById(req.user._id).select('following');
      const isFollowing = currentUser.following.some(id => 
        id.toString() === photo.owner._id.toString()
      );

      // Check visibility
      if (photo.visibility === 'private' || 
          (photo.visibility === 'followers' && !isFollowing)) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view this photo'
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Photo retrieved successfully',
      data: { photo }
    });
  } catch (error) {
    console.error('Get photo error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve photo'
    });
  }
});

// @route   PUT /api/photos/:id
// @desc    Update photo caption or visibility
// @access  Private
router.put('/:id', [
  body('caption')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Caption cannot exceed 500 characters'),
  body('visibility')
    .optional()
    .isIn(['public', 'followers', 'private'])
    .withMessage('Invalid visibility option')
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

    const photo = await Photo.findById(req.params.id);

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: 'Photo not found'
      });
    }

    // Check if user is the owner
    if (photo.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit your own photos'
      });
    }

    const { caption, visibility, tags } = req.body;

    if (caption !== undefined) photo.caption = caption;
    if (visibility !== undefined) photo.visibility = visibility;
    if (tags !== undefined) {
      try {
        const parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
        if (Array.isArray(parsedTags)) {
          photo.tags = parsedTags;
        }
      } catch (e) {
        console.error('Error parsing tags:', e);
      }
    }

    await photo.save();
    await photo.populate('owner', 'name email avatar');

    // Emit socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      // Get the owner's followers
      const User = require('../models/User');
      const owner = await User.findById(req.user._id).select('followers');
      const followerIds = owner.followers || [];
      
      // Emit to each follower individually
      followerIds.forEach(followerId => {
        io.to(`user:${followerId}`).emit('photo:updated', {
          photoId: photo._id,
          caption: photo.caption,
          visibility: photo.visibility,
          updatedAt: photo.updatedAt
        });
      });
      
      console.log(`📸 Emitted photo:updated to ${followerIds.length} followers`);
    }

    res.status(200).json({
      success: true,
      message: 'Photo updated successfully',
      data: { photo }
    });
  } catch (error) {
    console.error('Update photo error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update photo'
    });
  }
});

// @route   DELETE /api/photos/:id
// @desc    Delete a photo
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const photo = await Photo.findById(req.params.id);

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: 'Photo not found'
      });
    }

    // Check if user is the owner
    if (photo.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own photos'
      });
    }

    await Photo.findByIdAndDelete(req.params.id);

    // Emit socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      // Get the owner's followers
      const User = require('../models/User');
      const owner = await User.findById(req.user._id).select('followers');
      const followerIds = owner.followers || [];
      
      // Emit to each follower individually
      followerIds.forEach(followerId => {
        io.to(`user:${followerId}`).emit('photo:deleted', {
          photoId: req.params.id
        });
      });
      
      console.log(`📸 Emitted photo:deleted to ${followerIds.length} followers`);
    }

    res.status(200).json({
      success: true,
      message: 'Photo deleted successfully'
    });
  } catch (error) {
    console.error('Delete photo error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete photo'
    });
  }
});

module.exports = router;
