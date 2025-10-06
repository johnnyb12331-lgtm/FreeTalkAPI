const express = require('express');
const Story = require('../models/Story');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');
const upload = require('../config/multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// @route   POST /api/stories
// @desc    Create a new story
// @access  Private
router.post('/', authenticateToken, upload.single('media'), async (req, res) => {
  try {
    const { caption, backgroundColor, textContent, mediaType: requestedMediaType } = req.body;
    
    let mediaType, mediaUrl, storyTextContent;
    
    // Check if this is a text-only story
    if (requestedMediaType === 'text') {
      if (!textContent || textContent.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Text content is required for text stories'
        });
      }
      
      mediaType = 'text';
      mediaUrl = null;
      storyTextContent = textContent;
    } else {
      // Media story (image/video)
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Media file is required for image/video stories'
        });
      }
      
      // Determine media type from file
      mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';
      mediaUrl = `/uploads/${req.file.filename}`;
      storyTextContent = '';
    }
    
    // Create story
    const story = new Story({
      author: req.user._id,
      mediaType,
      mediaUrl,
      textContent: storyTextContent,
      caption: caption || '',
      backgroundColor: backgroundColor || '#000000',
      duration: mediaType === 'video' ? null : 5000 // 5 seconds for images and text
    });

    await story.save();
    
    // Populate author details
    await story.populate('author', 'name email avatar');

    // Get user's followers to create notifications
    const user = await User.findById(req.user._id).select('followers');
    
    // Create notifications for followers
    if (user.followers && user.followers.length > 0) {
      const notificationDocs = user.followers.map(followerId => ({
        recipient: followerId,
        sender: req.user._id,
        type: 'story',
        story: story._id,
        message: `posted a new story`
      }));
      
      const createdNotifications = await Notification.insertMany(notificationDocs);
      console.log(`📖 Created ${createdNotifications.length} story notifications for followers`);
      
      // Populate sender details for socket events
      await Notification.populate(createdNotifications, { path: 'sender', select: 'name email avatar' });
      
      // Emit socket event to all connected users (since stories are public)
      const io = req.app.get('io');
      if (io) {
        // Broadcast story:created to all connected users
        io.emit('story:created', {
          story: story.toJSON({ virtuals: true }),
          authorId: req.user._id
        });
        
        // Send individual notification events to each follower
        createdNotifications.forEach((notification, index) => {
          const followerId = user.followers[index];
          io.to(`user:${followerId}`).emit('notification:new', {
            notification: notification.toJSON()
          });
        });
        
        console.log(`📖 Story created by user ${req.user._id}, notifications sent to ${createdNotifications.length} followers`);
      }
    } else {
      // No followers, just broadcast story creation
      const io = req.app.get('io');
      if (io) {
        io.emit('story:created', {
          story: story.toJSON({ virtuals: true }),
          authorId: req.user._id
        });
        console.log(`📖 Story created by user ${req.user._id}, broadcasted to all users (no followers)`);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Story created successfully',
      data: {
        story: story.toJSON({ virtuals: true })
      }
    });

  } catch (error) {
    console.error('Create story error:', error);
    
    // Clean up uploaded file if error occurred
    if (req.file) {
      const filePath = path.join(__dirname, '..', 'uploads', req.file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create story'
    });
  }
});

// @route   GET /api/stories
// @desc    Get all active stories (grouped by user)
// @access  Private
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Get blocked user relationships
    const Block = require('../models/Block');
    const blockedUserIds = await Block.getAllBlockRelationships(req.user._id);

    // Get all active stories excluding blocked users
    const stories = await Story.find({
      expiresAt: { $gt: new Date() },
      author: { $nin: blockedUserIds } // Exclude stories from blocked users
    })
    .populate('author', 'name email avatar')
    .populate({
      path: 'reactions.user',
      select: 'name avatar',
      options: { strictPopulate: false }
    })
    .sort({ createdAt: -1 })
    .lean();

    // Group stories by author
    const storiesByAuthor = {};
    
    stories.forEach(story => {
      // Skip stories with deleted authors
      if (!story.author || !story.author._id) {
        console.warn('Story with missing author found:', story._id);
        return;
      }
      
      // Since we used .lean(), story is already a plain JS object
      const authorId = story.author._id.toString();
      
      if (!storiesByAuthor[authorId]) {
        storiesByAuthor[authorId] = {
          author: story.author,
          stories: [],
          hasUnseen: false
        };
      }
      
      // Add computed fields
      const hasViewed = story.viewers && story.viewers.some(
        viewer => viewer.user && viewer.user.toString() === req.user._id.toString()
      );
      
      const hasReacted = story.reactions && story.reactions.some(
        reaction => reaction.user && reaction.user._id && reaction.user._id.toString() === req.user._id.toString()
      );
      
      // Get user's reaction if exists
      const userReaction = story.reactions && story.reactions.find(
        r => r.user && r.user._id && r.user._id.toString() === req.user._id.toString()
      );
      
      const storyData = {
        ...story,
        hasViewed,
        hasReacted,
        viewersCount: story.viewers ? story.viewers.length : 0,
        reactionsCount: story.reactions ? story.reactions.length : 0,
        userReaction: userReaction ? userReaction.emoji : null
      };
      
      if (!hasViewed) {
        storiesByAuthor[authorId].hasUnseen = true;
      }
      
      storiesByAuthor[authorId].stories.push(storyData);
    });

    // Convert to array
    const groupedStories = Object.values(storiesByAuthor);

    res.status(200).json({
      success: true,
      message: 'Stories retrieved successfully',
      data: {
        stories: groupedStories,
        count: groupedStories.length
      }
    });

  } catch (error) {
    console.error('Get stories error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to get stories',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/stories/user/:userId
// @desc    Get stories by specific user
// @access  Private
router.get('/user/:userId', authenticateToken, async (req, res) => {
  try {
    // Check if there's a block relationship
    const Block = require('../models/Block');
    const isBlocked = await Block.isBlocked(req.user._id, req.params.userId);
    
    if (isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'You cannot view this user\'s stories'
      });
    }

    const stories = await Story.find({
      author: req.params.userId,
      expiresAt: { $gt: new Date() }
    })
    .populate('author', 'name email avatar')
    .populate('reactions.user', 'name avatar')
    .sort({ createdAt: 1 }); // Oldest first for viewing

    const storiesData = stories.map(story => {
      const data = story.toJSON({ virtuals: true });
      data.hasViewed = story.hasViewed(req.user._id);
      data.hasReacted = story.hasReacted(req.user._id);
      
      // Get user's reaction if exists
      const userReaction = story.reactions.find(
        r => r.user._id.toString() === req.user._id.toString()
      );
      if (userReaction) {
        data.userReaction = userReaction.emoji;
      }
      
      return data;
    });

    res.status(200).json({
      success: true,
      message: 'User stories retrieved successfully',
      data: {
        stories: storiesData,
        count: storiesData.length
      }
    });

  } catch (error) {
    console.error('Get user stories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user stories'
    });
  }
});

// @route   GET /api/stories/:storyId
// @desc    Get single story
// @access  Private
router.get('/:storyId', authenticateToken, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId)
      .populate('author', 'name email avatar')
      .populate('viewers.user', 'name avatar')
      .populate('reactions.user', 'name avatar');

    if (!story) {
      return res.status(404).json({
        success: false,
        message: 'Story not found'
      });
    }

    // Check if expired
    if (story.isExpired()) {
      return res.status(410).json({
        success: false,
        message: 'Story has expired'
      });
    }

    const storyData = story.toJSON({ virtuals: true });
    storyData.hasViewed = story.hasViewed(req.user._id);
    storyData.hasReacted = story.hasReacted(req.user._id);
    
    // Get user's reaction if exists
    const userReaction = story.reactions.find(
      r => r.user._id.toString() === req.user._id.toString()
    );
    if (userReaction) {
      storyData.userReaction = userReaction.emoji;
    }

    res.status(200).json({
      success: true,
      message: 'Story retrieved successfully',
      data: {
        story: storyData
      }
    });

  } catch (error) {
    console.error('Get story error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get story'
    });
  }
});

// @route   POST /api/stories/:storyId/view
// @desc    Mark story as viewed
// @access  Private
router.post('/:storyId/view', authenticateToken, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId)
      .populate('author', 'name email avatar');

    if (!story) {
      return res.status(404).json({
        success: false,
        message: 'Story not found'
      });
    }

    // Check if expired
    if (story.isExpired()) {
      return res.status(410).json({
        success: false,
        message: 'Story has expired'
      });
    }

    // Add viewer if not already viewed
    if (!story.hasViewed(req.user._id)) {
      story.addViewer(req.user._id);
      await story.save();
      
      // Emit socket event to story author
      const io = req.app.get('io');
      if (io && story.author._id.toString() !== req.user._id.toString()) {
        io.to(`user:${story.author._id}`).emit('story:viewed', {
          storyId: story._id,
          viewerId: req.user._id,
          viewerName: req.user.name,
          viewersCount: story.viewersCount
        });
        
        console.log(`👁️ Story ${story._id} viewed by ${req.user._id}`);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Story view recorded',
      data: {
        viewersCount: story.viewersCount
      }
    });

  } catch (error) {
    console.error('View story error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record story view'
    });
  }
});

// @route   POST /api/stories/:storyId/react
// @desc    React to a story
// @access  Private
router.post('/:storyId/react', authenticateToken, async (req, res) => {
  try {
    const { emoji } = req.body;
    
    if (!emoji || typeof emoji !== 'string' || emoji.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Emoji is required'
      });
    }

    const story = await Story.findById(req.params.storyId)
      .populate('author', 'name email avatar');

    if (!story) {
      return res.status(404).json({
        success: false,
        message: 'Story not found'
      });
    }

    // Check if expired
    if (story.isExpired()) {
      return res.status(410).json({
        success: false,
        message: 'Story has expired'
      });
    }

    // Check if reacting to own story
    if (story.author._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot react to your own story'
      });
    }

    // Add or update reaction
    story.addReaction(req.user._id, emoji);
    await story.save();
    
    // Populate the reactions for response
    await story.populate('reactions.user', 'name avatar');

    // Create notification for story author
    const notification = await Notification.create({
      recipient: story.author._id,
      sender: req.user._id,
      type: 'story_reaction',
      story: story._id,
      message: `reacted ${emoji} to your story`
    });
    
    await notification.populate('sender', 'name email avatar');
    
    // Emit socket events
    const io = req.app.get('io');
    if (io) {
      // Emit reaction event to story author
      io.to(`user:${story.author._id}`).emit('story:reaction', {
        storyId: story._id,
        reaction: {
          user: {
            _id: req.user._id,
            name: req.user.name,
            avatar: req.user.avatar
          },
          emoji: emoji,
          createdAt: new Date()
        },
        reactionsCount: story.reactionsCount
      });
      
      // Send notification to story author
      io.to(`user:${story.author._id}`).emit('notification:new', {
        notification: notification.toJSON()
      });
      
      console.log(`❤️ User ${req.user._id} reacted ${emoji} to story ${story._id}`);
    }

    res.status(200).json({
      success: true,
      message: 'Reaction added successfully',
      data: {
        reactionsCount: story.reactionsCount,
        reactions: story.reactions
      }
    });

  } catch (error) {
    console.error('React to story error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reaction'
    });
  }
});

// @route   DELETE /api/stories/:storyId/react
// @desc    Remove reaction from a story
// @access  Private
router.delete('/:storyId/react', authenticateToken, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId)
      .populate('author', 'name email avatar');

    if (!story) {
      return res.status(404).json({
        success: false,
        message: 'Story not found'
      });
    }

    // Check if expired
    if (story.isExpired()) {
      return res.status(410).json({
        success: false,
        message: 'Story has expired'
      });
    }

    // Remove reaction
    story.removeReaction(req.user._id);
    await story.save();

    // Emit socket event to story author
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${story.author._id}`).emit('story:reaction-removed', {
        storyId: story._id,
        userId: req.user._id,
        reactionsCount: story.reactionsCount
      });
      
      console.log(`💔 User ${req.user._id} removed reaction from story ${story._id}`);
    }

    res.status(200).json({
      success: true,
      message: 'Reaction removed successfully',
      data: {
        reactionsCount: story.reactionsCount
      }
    });

  } catch (error) {
    console.error('Remove story reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove reaction'
    });
  }
});

// @route   DELETE /api/stories/:storyId
// @desc    Delete own story
// @access  Private
router.delete('/:storyId', authenticateToken, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);

    if (!story) {
      return res.status(404).json({
        success: false,
        message: 'Story not found'
      });
    }

    // Check if user is the author
    if (story.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own stories'
      });
    }

    // Delete media file
    const filePath = path.join(__dirname, '..', story.mediaUrl.replace(/^\//, ''));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await Story.findByIdAndDelete(req.params.storyId);

    // Emit socket event to all connected users
    const io = req.app.get('io');
    if (io) {
      // Broadcast to all connected users
      io.emit('story:deleted', {
        storyId: story._id,
        authorId: req.user._id
      });
      
      console.log(`🗑️ Story ${story._id} deleted and broadcasted`);
    }

    res.status(200).json({
      success: true,
      message: 'Story deleted successfully'
    });

  } catch (error) {
    console.error('Delete story error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete story'
    });
  }
});

// @route   DELETE /api/stories/cleanup/expired
// @desc    Delete all expired stories (cron job endpoint)
// @access  Private (could be protected with API key in production)
router.delete('/cleanup/expired', async (req, res) => {
  try {
    const result = await Story.deleteExpired();
    
    console.log(`🧹 Cleaned up ${result.deletedCount} expired stories`);
    
    res.status(200).json({
      success: true,
      message: `Deleted ${result.deletedCount} expired stories`
    });

  } catch (error) {
    console.error('Cleanup expired stories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup expired stories'
    });
  }
});

// @route   GET /api/stories/:storyId/viewers
// @desc    Get story viewers list
// @access  Private (only story author)
router.get('/:storyId/viewers', authenticateToken, async (req, res) => {
  try {
    console.log(`📊 Getting viewers for story ${req.params.storyId} by user ${req.user._id}`);
    
    const story = await Story.findById(req.params.storyId)
      .populate('viewers.user', 'name email avatar')
      .populate('author', '_id');

    if (!story) {
      console.log(`❌ Story ${req.params.storyId} not found`);
      return res.status(404).json({
        success: false,
        message: 'Story not found'
      });
    }

    console.log(`📊 Story found. Author: ${story.author._id}, Viewers count: ${story.viewers.length}`);

    // Check if the requester is the story author
    if (story.author._id.toString() !== req.user._id.toString()) {
      console.log(`❌ User ${req.user._id} is not the author of story ${req.params.storyId}`);
      return res.status(403).json({
        success: false,
        message: 'You can only view viewers for your own stories'
      });
    }

    console.log(`✅ Returning ${story.viewers.length} viewers`);
    console.log(`📊 Viewers data:`, JSON.stringify(story.viewers, null, 2));

    res.status(200).json({
      success: true,
      message: 'Story viewers retrieved successfully',
      data: {
        viewers: story.viewers,
        count: story.viewers.length
      }
    });

  } catch (error) {
    console.error('Get story viewers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get story viewers'
    });
  }
});

module.exports = router;
