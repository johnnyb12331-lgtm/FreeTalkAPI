const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const Memory = require('../models/Memory');
const Post = require('../models/Post');
const mongoose = require('mongoose');

// @route   GET /api/memories
// @desc    Get all memories for the authenticated user
// @access  Private
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { 
      includeViewed = false, 
      limit = 20, 
      page = 1,
      type,
      collection,
      year
    } = req.query;
    
    const query = { user: req.user.userId };
    
    // Apply filters
    if (!includeViewed || includeViewed === 'false') {
      query.viewed = false;
    }
    
    if (type) {
      query.type = type;
    }
    
    if (collection) {
      query.collection = collection;
    }
    
    if (year) {
      query.year = parseInt(year);
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const memories = await Memory.find(query)
      .populate({
        path: 'post',
        populate: [
          { path: 'author', select: 'name profilePicture username' },
          { path: 'reactions.user', select: 'name profilePicture username' },
          { path: 'comments.user', select: 'name profilePicture username' }
        ]
      })
      .sort({ originalDate: -1, yearsAgo: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Memory.countDocuments(query);
    
    res.json({
      success: true,
      memories,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching memories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch memories',
      error: error.message
    });
  }
});

// @route   GET /api/memories/today
// @desc    Get today's memories for the authenticated user
// @access  Private
router.get('/today', authenticateToken, async (req, res) => {
  try {
    const { includeViewed = false, limit = 20 } = req.query;
    
    const memoryService = req.app.get('memoryService');
    
    // Generate fresh memories if needed
    await memoryService.generateMemoriesForUser(req.user.userId);
    
    // Get today's memories
    const memories = await Memory.getTodaysMemories(req.user.userId, {
      includeViewed: includeViewed === 'true',
      limit: parseInt(limit)
    });
    
    res.json({
      success: true,
      count: memories.length,
      memories
    });
  } catch (error) {
    console.error('Error fetching today\'s memories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch today\'s memories',
      error: error.message
    });
  }
});

// @route   GET /api/memories/collections
// @desc    Get memory collections for the authenticated user
// @access  Private
router.get('/collections', authenticateToken, async (req, res) => {
  try {
    const collections = await Memory.getCollections(req.user.userId);
    
    res.json({
      success: true,
      collections
    });
  } catch (error) {
    console.error('Error fetching memory collections:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch memory collections',
      error: error.message
    });
  }
});

// @route   GET /api/memories/:id
// @desc    Get a specific memory by ID
// @access  Private
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const memory = await Memory.findOne({
      _id: req.params.id,
      user: req.user.userId
    }).populate({
      path: 'post',
      populate: [
        { path: 'author', select: 'name profilePicture username' },
        { path: 'reactions.user', select: 'name profilePicture username' },
        { path: 'comments.user', select: 'name profilePicture username' }
      ]
    });
    
    if (!memory) {
      return res.status(404).json({
        success: false,
        message: 'Memory not found'
      });
    }
    
    res.json({
      success: true,
      memory
    });
  } catch (error) {
    console.error('Error fetching memory:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch memory',
      error: error.message
    });
  }
});

// @route   POST /api/memories/generate
// @desc    Manually generate memories for the authenticated user
// @access  Private
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const memoryService = req.app.get('memoryService');
    const count = await memoryService.generateMemoriesForUser(req.user.userId);
    
    res.json({
      success: true,
      message: `Generated ${count} new memories`,
      count
    });
  } catch (error) {
    console.error('Error generating memories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate memories',
      error: error.message
    });
  }
});

// @route   PATCH /api/memories/:id/view
// @desc    Mark a memory as viewed
// @access  Private
router.patch('/:id/view', authenticateToken, async (req, res) => {
  try {
    const memory = await Memory.findOne({
      _id: req.params.id,
      user: req.user.userId
    });
    
    if (!memory) {
      return res.status(404).json({
        success: false,
        message: 'Memory not found'
      });
    }
    
    await memory.markAsViewed();
    
    // Notify via real-time
    const memoryService = req.app.get('memoryService');
    await memoryService.notifyMemoryInteraction(req.user.userId, memory._id, 'viewed');
    
    res.json({
      success: true,
      message: 'Memory marked as viewed',
      memory
    });
  } catch (error) {
    console.error('Error marking memory as viewed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark memory as viewed',
      error: error.message
    });
  }
});

// @route   PATCH /api/memories/:id/share
// @desc    Mark a memory as shared and optionally reshare the post
// @access  Private
router.patch('/:id/share', authenticateToken, async (req, res) => {
  try {
    const { reshareContent } = req.body;
    
    const memory = await Memory.findOne({
      _id: req.params.id,
      user: req.user.userId
    }).populate('post');
    
    if (!memory) {
      return res.status(404).json({
        success: false,
        message: 'Memory not found'
      });
    }
    
    await memory.markAsShared();
    
    // Optionally create a new post sharing this memory
    let newPost = null;
    if (reshareContent !== undefined) {
      newPost = await Post.create({
        content: reshareContent || `${memory.yearsAgo} year${memory.yearsAgo !== 1 ? 's' : ''} ago today...`,
        author: req.user.userId,
        isReshare: true,
        originalPost: memory.post._id,
        mediaType: memory.post.mediaType,
        images: memory.post.images,
        videos: memory.post.videos
      });
    }
    
    // Notify via real-time
    const memoryService = req.app.get('memoryService');
    await memoryService.notifyMemoryInteraction(req.user.userId, memory._id, 'shared');
    
    res.json({
      success: true,
      message: 'Memory marked as shared',
      memory,
      newPost
    });
  } catch (error) {
    console.error('Error sharing memory:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share memory',
      error: error.message
    });
  }
});

// @route   PATCH /api/memories/:id
// @desc    Update a memory (add note, collection, tags)
// @access  Private
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { note, collection, tags } = req.body;
    
    const memory = await Memory.findOne({
      _id: req.params.id,
      user: req.user.userId
    });
    
    if (!memory) {
      return res.status(404).json({
        success: false,
        message: 'Memory not found'
      });
    }
    
    if (note !== undefined) memory.note = note;
    if (collection !== undefined) memory.collection = collection;
    if (tags !== undefined) memory.tags = tags;
    
    await memory.save();
    
    // Notify via real-time
    const memoryService = req.app.get('memoryService');
    await memoryService.notifyMemoryInteraction(req.user.userId, memory._id, 'updated');
    
    res.json({
      success: true,
      message: 'Memory updated successfully',
      memory
    });
  } catch (error) {
    console.error('Error updating memory:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update memory',
      error: error.message
    });
  }
});

// @route   DELETE /api/memories/:id
// @desc    Delete a memory
// @access  Private
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const memory = await Memory.findOneAndDelete({
      _id: req.params.id,
      user: req.user.userId
    });
    
    if (!memory) {
      return res.status(404).json({
        success: false,
        message: 'Memory not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Memory deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting memory:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete memory',
      error: error.message
    });
  }
});

// @route   GET /api/memories/stats
// @desc    Get memory statistics for the authenticated user
// @access  Private
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get various statistics
    const [
      totalMemories,
      viewedMemories,
      sharedMemories,
      memoriesByType,
      recentMemories
    ] = await Promise.all([
      Memory.countDocuments({ user: userId }),
      Memory.countDocuments({ user: userId, viewed: true }),
      Memory.countDocuments({ user: userId, shared: true }),
      Memory.aggregate([
        { $match: { user: mongoose.Types.ObjectId(userId) } },
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ]),
      Memory.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('type yearsAgo originalDate viewed shared')
    ]);
    
    res.json({
      success: true,
      stats: {
        total: totalMemories,
        viewed: viewedMemories,
        shared: sharedMemories,
        unviewed: totalMemories - viewedMemories,
        byType: memoriesByType,
        recent: recentMemories
      }
    });
  } catch (error) {
    console.error('Error fetching memory stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch memory statistics',
      error: error.message
    });
  }
});

module.exports = router;
