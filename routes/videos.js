const express = require('express');
const { body, validationResult } = require('express-validator');
const Video = require('../models/Video');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');
const { optionalAuth } = require('../middleware/optionalAuth');
const upload = require('../config/multer');

const router = express.Router();

// Most routes require authentication (except public endpoints like view counting)
// NOTE: Individual routes that need public access will use optionalAuth instead

// Validation rules
const createVideoValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Video title is required')
    .isLength({ max: 200 })
    .withMessage('Title cannot exceed 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description cannot exceed 2000 characters')
];

const commentValidation = [
  body('text')
    .trim()
    .notEmpty()
    .withMessage('Comment text is required')
    .isLength({ max: 1000 })
    .withMessage('Comment cannot exceed 1000 characters')
];

// @route   GET /api/videos
// @desc    Get all videos (feed)
// @access  Private
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    console.log(`📹 GET /api/videos - User: ${req.user?._id}, Page: ${page}, Limit: ${limit}`);

    // Check if user is authenticated
    if (!req.user || !req.user._id) {
      console.error('❌ User not authenticated or missing user ID');
      return res.status(401).json({
        success: false,
        message: 'User authentication failed'
      });
    }

    // Get blocked user relationships
    const Block = require('../models/Block');
    console.log('📹 Fetching blocked users...');
    const blockedUserIds = await Block.getAllBlockRelationships(req.user._id);
    console.log(`📹 Found ${blockedUserIds.length} blocked users`);

    console.log('📹 Fetching video feed...');
    const result = await Video.getFeed({
      userId: req.user._id,
      page: parseInt(page),
      limit: parseInt(limit),
      excludeBlockedUsers: blockedUserIds
    });

    console.log(`📹 Retrieved ${result.videos.length} videos from database`);

    // Format videos with additional metadata
    const formattedVideos = result.videos.map(video => ({
      ...video,
      isLiked: video.likes?.some(like => like.user.toString() === req.user._id.toString()) || false,
      isViewed: video.views?.some(view => view.user.toString() === req.user._id.toString()) || false,
      likeCount: video.likes?.length || 0,
      viewCount: video.views?.length || 0,
      commentCount: video.comments?.length || 0,
      // Remove full arrays to reduce payload size
      likes: undefined,
      views: undefined,
      comments: undefined
    }));

    console.log(`✅ Successfully formatted ${formattedVideos.length} videos for feed`);

    res.status(200).json({
      success: true,
      message: 'Videos retrieved successfully',
      data: {
        videos: formattedVideos,
        pagination: result.pagination
      }
    });
  } catch (error) {
    console.error('❌ Get videos error:', error);
    console.error('❌ Error name:', error.name);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve videos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/videos/search
// @desc    Search videos by title or description
// @access  Private
router.get('/search', async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    
    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const searchQuery = q.trim();

    // Get blocked user relationships
    const Block = require('../models/Block');
    const blockedUserIds = await Block.getAllBlockRelationships(req.user._id);

    // Get current user with following list
    const currentUser = await User.findById(req.user._id).select('following');
    const followingIds = currentUser.following || [];

    // Search videos by title or description (case-insensitive)
    // Only search videos from users the current user follows
    const searchRegex = new RegExp(searchQuery, 'i');
    const videos = await Video.find({
      $or: [
        { title: searchRegex },
        { description: searchRegex }
      ],
      author: { 
        $in: followingIds,
        $nin: blockedUserIds
      },
      isDeleted: false
    })
      .populate('author', 'name email avatar')
      .populate('taggedUsers', 'name email avatar isPremium premiumFeatures')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    // Get total count for pagination
    const total = await Video.countDocuments({
      $or: [
        { title: searchRegex },
        { description: searchRegex }
      ],
      author: { 
        $in: followingIds,
        $nin: blockedUserIds
      },
      isDeleted: false
    });

    // Format videos with metadata
    const formattedVideos = videos.map(video => ({
      ...video,
      isLiked: video.likes?.some(like => like.user.toString() === req.user._id.toString()) || false,
      isViewed: video.views?.some(view => view.user.toString() === req.user._id.toString()) || false,
      likeCount: video.likes?.length || 0,
      viewCount: video.views?.length || 0,
      commentCount: video.comments?.length || 0,
      likes: undefined,
      views: undefined,
      comments: undefined
    }));

    console.log(`🔍 Search for "${searchQuery}" found ${videos.length} videos`);

    res.status(200).json({
      success: true,
      data: {
        videos: formattedVideos,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        },
        query: searchQuery
      }
    });
  } catch (error) {
    console.error('Search videos error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search videos'
    });
  }
});

// @route   GET /api/videos/user/:userId
// @desc    Get videos by specific user
// @access  Private
router.get('/user/:userId', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Validate userId format
    if (!req.params.userId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    const result = await Video.getUserVideos(req.params.userId, {
      page: parseInt(page),
      limit: parseInt(limit)
    });

    // Format videos
    const formattedVideos = result.videos.map(video => ({
      ...video,
      isLiked: video.likes?.some(like => like.user.toString() === req.user._id.toString()) || false,
      isViewed: video.views?.some(view => view.user.toString() === req.user._id.toString()) || false,
      likeCount: video.likes?.length || 0,
      viewCount: video.views?.length || 0,
      commentCount: video.comments?.length || 0,
      likes: undefined,
      views: undefined,
      comments: undefined
    }));

    res.status(200).json({
      success: true,
      message: 'User videos retrieved successfully',
      data: {
        videos: formattedVideos,
        pagination: result.pagination
      }
    });
  } catch (error) {
    console.error('Get user videos error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user videos'
    });
  }
});

// @route   GET /api/videos/:id
// @desc    Get single video by ID
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    // Validate ObjectId format
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid video ID format'
      });
    }

    const video = await Video.findById(req.params.id)
      .populate('author', 'name email avatar')
      .populate('taggedUsers', 'name email avatar isPremium premiumFeatures')
      .populate('comments.user', 'name email avatar isPremium premiumFeatures');

    if (!video || video.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // Check if user has liked or viewed the video
    const isLiked = video.isLikedByUser(req.user._id);
    const isViewed = video.isViewedByUser(req.user._id);

    res.status(200).json({
      success: true,
      message: 'Video retrieved successfully',
      data: {
        video: {
          ...video.toJSON(),
          isLiked,
          isViewed
        }
      }
    });
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve video'
    });
  }
});

// @route   POST /api/videos
// @desc    Upload a new video
// @access  Private
router.post('/', upload.single('video'), createVideoValidation, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // Check if video file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Video file is required'
      });
    }

    // Validate file type
    const allowedTypes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid video format. Only MP4, MPEG, MOV, AVI, and WebM are allowed'
      });
    }

    const { 
      title, 
      description, 
      taggedUsers, 
      visibility = 'public',
      // Audio track fields
      musicTrackId,
      audioTitle,
      audioArtist,
      audioUrl,
      audioSource,
      audioLicense,
      audioExternalId,
      originalAudio = 'true',
      audioStartTime = 0,
      audioDuration,
      audioVolume = 100
    } = req.body;

    // Parse tagged users if provided
    let parsedTaggedUsers = [];
    if (taggedUsers) {
      try {
        parsedTaggedUsers = typeof taggedUsers === 'string' ? JSON.parse(taggedUsers) : taggedUsers;
      } catch (e) {
        console.error('Error parsing tagged users:', e);
      }
    }

    // Create video URL (adjust based on your server setup)
    const videoUrl = `/uploads/${req.file.filename}`;

    // Prepare audio track data
    let audioTrackData = null;
    if (musicTrackId || audioUrl) {
      audioTrackData = {};
      
      if (musicTrackId) {
        audioTrackData.musicTrackId = musicTrackId;
        // Increment usage count for the music track
        const MusicTrack = require('../models/MusicTrack');
        const track = await MusicTrack.findById(musicTrackId);
        if (track) {
          await track.incrementUsage();
          audioTrackData.url = track.url;
          audioTrackData.title = track.title;
          audioTrackData.artist = track.artist;
          audioTrackData.source = track.source;
          audioTrackData.license = track.license;
        }
      } else {
        // Custom audio
        audioTrackData.url = audioUrl;
        audioTrackData.title = audioTitle || 'Original Sound';
        audioTrackData.artist = audioArtist || req.user.name;
        audioTrackData.source = audioSource || 'original';
        audioTrackData.license = audioLicense;
        audioTrackData.externalId = audioExternalId;
      }
    }

    // Create new video document
    const video = new Video({
      author: req.user._id,
      title,
      description,
      videoUrl,
      taggedUsers: parsedTaggedUsers,
      visibility,
      audioTrack: audioTrackData,
      originalAudio: originalAudio === 'true' || originalAudio === true,
      audioStartTime: parseFloat(audioStartTime) || 0,
      audioDuration: audioDuration ? parseFloat(audioDuration) : null,
      audioVolume: parseInt(audioVolume) || 100
    });

    await video.save();

    // Populate author and tagged users
    await video.populate('author', 'name email avatar');
    await video.populate('taggedUsers', 'name email avatar isPremium premiumFeatures');

    console.log(`📹 New video created: ${video._id} by ${req.user.name}`);

    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      io.emit('video:created', {
        video: {
          ...video.toJSON(),
          likeCount: 0,
          viewCount: 0,
          commentCount: 0,
          isLiked: false,
          isViewed: false
        }
      });
      console.log('🔔 Emitted video:created event');
    }

    // Create notifications for tagged users
    if (parsedTaggedUsers && parsedTaggedUsers.length > 0) {
      const notificationPromises = parsedTaggedUsers.map(async (userId) => {
        const notification = new Notification({
          recipient: userId,
          sender: req.user._id,
          type: 'video_tag',
          message: `${req.user.name} tagged you in a video`,
          relatedVideo: video._id
        });
        await notification.save();
        await notification.populate('sender', 'name email avatar');

        // Emit notification to tagged user
        if (io) {
          io.to(`user:${userId}`).emit('notification:new', {
            notification: notification.toJSON()
          });
          
          // Get updated unread count
          const unreadCount = await Notification.countDocuments({
            recipient: userId,
            isRead: false
          });
          
          // Emit unread count update
          io.to(`user:${userId}`).emit('notification:unread-count', {
            unreadCount
          });
          
          console.log(`🔔 Video tag notification sent to user:${userId}, unread count: ${unreadCount}`);
        }
      });

      await Promise.all(notificationPromises);
    }

    res.status(201).json({
      success: true,
      message: 'Video uploaded successfully',
      data: { video }
    });
  } catch (error) {
    console.error('Upload video error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload video'
    });
  }
});

// @route   POST /api/videos/:id/view
// @desc    Record a video view
// @access  Public (optional auth)
router.post('/:id/view', optionalAuth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);

    if (!video || video.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // If user is authenticated, track individual views
    // If not authenticated, just increment view count
    if (req.user) {
      // Check if user has already viewed the video
      const hasViewed = video.views.some(view => 
        view.user.toString() === req.user._id.toString()
      );

      if (!hasViewed) {
        video.views.push({
          user: req.user._id,
          viewedAt: new Date()
        });
        await video.save();
        console.log(`👁️ User ${req.user.name} viewed video ${video._id}`);

        // Emit socket event for real-time view count updates
        const io = req.app.get('io');
        if (io) {
          io.emit('video:viewed', {
            videoId: video._id,
            viewCount: video.views.length,
            userId: req.user._id
          });
          console.log('🔔 Emitted video:viewed event');
        }
      }
    } else {
      // Anonymous view - just increment counter without tracking user
      console.log(`👁️ Anonymous user viewed video ${video._id}`);
      // We still track it in the views array but without a user ID
      // This allows consistent view counting
      video.views.push({
        viewedAt: new Date()
        // No user field - indicates anonymous view
      });
      await video.save();
      
      // Emit socket event for anonymous view
      const io = req.app.get('io');
      if (io) {
        io.emit('video:viewed', {
          videoId: video._id,
          viewCount: video.views.length
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'View recorded successfully',
      data: { viewCount: video.views.length }
    });
  } catch (error) {
    console.error('Record view error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record view'
    });
  }
});

// @route   POST /api/videos/:id/like
// @desc    Like or unlike a video
// @access  Private
router.post('/:id/like', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id).populate('author', 'name email avatar');

    if (!video || video.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // Check if user has already liked the video
    const likeIndex = video.likes.findIndex(like => 
      like.user.toString() === req.user._id.toString()
    );

    let action;
    if (likeIndex > -1) {
      // Unlike
      video.likes.splice(likeIndex, 1);
      action = 'unliked';
    } else {
      // Like
      video.likes.push({
        user: req.user._id,
        createdAt: new Date()
      });
      action = 'liked';

      // Create notification for video author (if not the same user)
      if (video.author._id.toString() !== req.user._id.toString()) {
        const notification = new Notification({
          recipient: video.author._id,
          sender: req.user._id,
          type: 'video_like',
          message: `${req.user.name} liked your video`,
          relatedVideo: video._id
        });
        await notification.save();
        await notification.populate('sender', 'name email avatar');

        // Emit notification via socket
        const io = req.app.get('io');
        if (io) {
          io.to(`user:${video.author._id}`).emit('notification:new', {
            notification: notification.toJSON()
          });
          
          // Get updated unread count for the video author
          const Notification = require('../models/Notification');
          const unreadCount = await Notification.countDocuments({
            recipient: video.author._id,
            isRead: false
          });
          
          // Emit unread count update
          io.to(`user:${video.author._id}`).emit('notification:unread-count', {
            unreadCount
          });
          
          console.log(`🔔 Video like notification sent to user:${video.author._id}, unread count: ${unreadCount}`);
        }
      }
    }

    await video.save();
    console.log(`❤️ User ${req.user.name} ${action} video ${video._id}`);

    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      io.emit('video:liked', {
        videoId: video._id,
        userId: req.user._id,
        action,
        likeCount: video.likes.length
      });
    }

    res.status(200).json({
      success: true,
      message: `Video ${action} successfully`,
      data: {
        action,
        likeCount: video.likes.length,
        isLiked: action === 'liked'
      }
    });
  } catch (error) {
    console.error('Like video error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to like video'
    });
  }
});

// @route   POST /api/videos/:id/comment
// @desc    Add a comment to a video
// @access  Private
router.post('/:id/comment', commentValidation, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const video = await Video.findById(req.params.id).populate('author', 'name email avatar');

    if (!video || video.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    const { text } = req.body;

    // Add comment
    const comment = {
      user: req.user._id,
      text,
      createdAt: new Date()
    };

    video.comments.push(comment);
    await video.save();

    // Get the newly added comment with populated user
    const populatedVideo = await Video.findById(video._id)
      .populate('comments.user', 'name email avatar isPremium premiumFeatures');
    
    const newComment = populatedVideo.comments[populatedVideo.comments.length - 1];

    console.log(`💬 User ${req.user.name} commented on video ${video._id}`);

    // Create notification for video author (if not the same user)
    if (video.author._id.toString() !== req.user._id.toString()) {
      const notification = new Notification({
        recipient: video.author._id,
        sender: req.user._id,
        type: 'video_comment',
        message: `${req.user.name} commented on your video`,
        relatedVideo: video._id
      });
      await notification.save();
      await notification.populate('sender', 'name email avatar');

      // Emit notification via socket
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${video.author._id}`).emit('notification:new', {
          notification: notification.toJSON()
        });
        
        // Get updated unread count for the video author
        const Notification = require('../models/Notification');
        const unreadCount = await Notification.countDocuments({
          recipient: video.author._id,
          isRead: false
        });
        
        // Emit unread count update
        io.to(`user:${video.author._id}`).emit('notification:unread-count', {
          unreadCount
        });
        
        console.log(`🔔 Video comment notification sent to user:${video.author._id}, unread count: ${unreadCount}`);
      }
    }

    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      io.emit('video:commented', {
        videoId: video._id,
        comment: newComment,
        commentCount: video.comments.length
      });
    }

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: {
        comment: newComment,
        commentCount: video.comments.length
      }
    });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment'
    });
  }
});

// @route   GET /api/videos/:id/comments
// @desc    Get all comments for a video
// @access  Private
router.get('/:id/comments', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id)
      .populate('comments.user', 'name email avatar isPremium premiumFeatures')
      .select('comments');

    if (!video || video.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Comments retrieved successfully',
      data: {
        comments: video.comments,
        commentCount: video.comments.length
      }
    });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve comments'
    });
  }
});

// @route   DELETE /api/videos/:id
// @desc    Delete a video (soft delete)
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);

    if (!video || video.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // Check if user is the author or an admin
    if (video.author.toString() !== req.user._id.toString() && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this video'
      });
    }

    // Soft delete
    video.isDeleted = true;
    await video.save();

    console.log(`🗑️ Video ${video._id} deleted by ${req.user.name}`);

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('video:deleted', {
        videoId: video._id
      });
    }

    res.status(200).json({
      success: true,
      message: 'Video deleted successfully'
    });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete video'
    });
  }
});

module.exports = router;
