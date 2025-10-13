const express = require('express');
const { body, validationResult } = require('express-validator');
const Post = require('../models/Post');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');
const upload = require('../config/multer');
const { 
  createContentLimiter, 
  generalLimiter, 
  searchLimiter, 
  reactionLimiter,
  strictLimiter 
} = require('../middleware/rateLimiter');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Apply general rate limiting to all post routes
router.use(generalLimiter);

// Validation rules
const createPostValidation = [
  body('content')
    .trim()
    .notEmpty()
    .withMessage('Post content is required')
    .isLength({ max: 5000 })
    .withMessage('Post content cannot exceed 5000 characters')
];

const commentValidation = [
  body('content')
    .trim()
    .custom((value, { req }) => {
      // Content is required if no GIF is provided
      if (!value && !req.body.gif) {
        throw new Error('Comment content or GIF is required');
      }
      return true;
    })
    .isLength({ max: 1000 })
    .withMessage('Comment cannot exceed 1000 characters'),
  body('gif')
    .optional()
    .trim()
    .isURL()
    .withMessage('GIF must be a valid URL')
];

// @route   GET /api/posts/search
// @desc    Search posts by content
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
    const User = require('../models/User');
    const currentUser = await User.findById(req.user._id).select('following');
    
    // Users can search posts from people they follow
    const followingIds = currentUser.following || [];
    
    // Use only followed users
    const allAllowedAuthorIds = followingIds;

    // Search posts by content (case-insensitive)
    const posts = await Post.find({
      visibility: 'public',
      content: { $regex: searchQuery, $options: 'i' },
      author: { 
        $in: allAllowedAuthorIds, // Search posts from users the current user follows
        $nin: blockedUserIds // Exclude posts from blocked users
      }
    })
      .select('content author images videos reactions comments createdAt isReshare originalPost reshareCaption mediaType')
      .populate('author', 'name email avatar isPremium premiumFeatures')
      .populate({
        path: 'originalPost',
        select: 'content author images videos mediaType reactions comments createdAt',
        populate: {
          path: 'author',
          select: 'name email avatar'
        }
      })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    // Get total count for pagination
    const total = await Post.countDocuments({
      visibility: 'public',
      content: { $regex: searchQuery, $options: 'i' },
      author: { 
        $in: followingIds,
        $nin: blockedUserIds
      }
    });

    // Format posts similar to feed
    const formattedPosts = posts.map(post => {
      const commentsArray = post.comments || [];
      const reactionsArray = post.reactions || [];
      
      return {
        ...post,
        likesCount: reactionsArray.length,
        reactionsCount: reactionsArray.length,
        commentsCount: commentsArray.length,
        comments: undefined // Remove full comments array
      };
    });

    console.log(`🔍 Search for "${searchQuery}" found ${posts.length} posts`);

    res.status(200).json({
      success: true,
      data: {
        posts: formattedPosts,
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
    console.error('Search posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search posts'
    });
  }
});

// @route   GET /api/posts/top
// @desc    Get top posts from user's followers by engagement
// @access  Private
router.get('/top', async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    // Get blocked user relationships
    const Block = require('../models/Block');
    const blockedUserIds = await Block.getAllBlockRelationships(req.user._id);

    // Get current user with following list
    const User = require('../models/User');
    const currentUser = await User.findById(req.user._id).select('following');
    
    // Get posts from users the current user follows
    const followingIds = currentUser.following || [];
    
    // Use only followed users
    const allAllowedAuthorIds = followingIds;

    if (allAllowedAuthorIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No top posts available',
        data: {
          posts: [],
          count: 0
        }
      });
    }

    // Aggregate posts with engagement score calculation
    const posts = await Post.aggregate([
      {
        $match: {
          visibility: 'public',
          author: { 
            $in: allAllowedAuthorIds,
            $nin: blockedUserIds
          }
        }
      },
      {
        $addFields: {
          likeCount: { $size: { $ifNull: ['$reactions', []] } },
          commentCount: { $size: { $ifNull: ['$comments', []] } },
          // Engagement score: likes * 2 + comments * 3
          engagementScore: {
            $add: [
              { $multiply: [{ $size: { $ifNull: ['$reactions', []] } }, 2] },
              { $multiply: [{ $size: { $ifNull: ['$comments', []] } }, 3] }
            ]
          }
        }
      },
      {
        $match: {
          engagementScore: { $gt: 0 } // Only include posts with engagement
        }
      },
      {
        $sort: { engagementScore: -1 }
      },
      {
        $limit: parseInt(limit)
      },
      {
        $lookup: {
          from: 'users',
          localField: 'author',
          foreignField: '_id',
          as: 'author'
        }
      },
      {
        $unwind: '$author'
      },
      {
        $lookup: {
          from: 'users',
          localField: 'taggedUsers',
          foreignField: '_id',
          as: 'taggedUsers'
        }
      },
      {
        $lookup: {
          from: 'posts',
          localField: 'originalPost',
          foreignField: '_id',
          as: 'originalPost'
        }
      },
      {
        $unwind: {
          path: '$originalPost',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'originalPost.author',
          foreignField: '_id',
          as: 'originalPost.author'
        }
      },
      {
        $unwind: {
          path: '$originalPost.author',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          content: 1,
          author: {
            _id: 1,
            name: 1,
            email: 1,
            avatar: 1,
            isPremium: 1,
            premiumFeatures: 1,
            isVerified: 1
          },
          images: 1,
          videos: 1,
          mediaType: 1,
          reactions: 1,
          comments: 1,
          isReshare: 1,
          reshareCaption: 1,
          taggedUsers: {
            _id: 1,
            name: 1,
            email: 1,
            avatar: 1
          },
          originalPost: {
            _id: 1,
            content: 1,
            author: {
              _id: 1,
              name: 1,
              email: 1,
              avatar: 1
            },
            images: 1,
            videos: 1,
            mediaType: 1,
            reactions: 1,
            comments: 1,
            createdAt: 1
          },
          createdAt: 1,
          likeCount: 1,
          commentCount: 1,
          engagementScore: 1
        }
      }
    ]);

    res.status(200).json({
      success: true,
      message: 'Top posts retrieved successfully',
      data: {
        posts,
        count: posts.length
      }
    });

  } catch (error) {
    console.error('Error fetching top posts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch top posts'
    });
  }
});

// @route   GET /api/posts
// @desc    Get all posts (feed) - Optimized with lean queries
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get blocked user relationships
    const Block = require('../models/Block');
    const blockedUserIds = await Block.getAllBlockRelationships(req.user._id);

    // Get current user with following list
    const User = require('../models/User');
    const currentUser = await User.findById(req.user._id).select('following');
    
    // Users can see posts from people they follow AND their own posts
    const followingIds = currentUser.following || [];
    // Add current user's ID to see their own posts in the feed
    const allowedAuthorIds = [...followingIds, req.user._id];
    
    console.log(`📊 Feed for user ${req.user._id}:`);
    console.log(`   - Following: ${followingIds.length} users`);
    console.log(`   - Blocked: ${blockedUserIds.length} users`);
    
    // Use only followed users and current user
    const allAllowedAuthorIds = allowedAuthorIds;

    // Use lean() for better performance and select only needed fields
    // Don't populate full comments on list view - only load when needed
    const posts = await Post.find({ 
      visibility: 'public',
      author: { 
        $in: allAllowedAuthorIds, // Show posts from users the current user follows + own posts
        $nin: blockedUserIds // Exclude posts from blocked users
      }
    })
      .select('content author images videos reactions comments createdAt isReshare originalPost reshareCaption mediaType taggedUsers') // Select needed fields including reshare fields
      .populate('author', 'name email avatar isPremium premiumFeatures')
      .populate('taggedUsers', 'name email avatar')
      .populate({
        path: 'originalPost',
        select: 'content author images videos mediaType reactions comments createdAt taggedUsers',
        populate: [
          {
            path: 'author',
            select: 'name email avatar'
          },
          {
            path: 'taggedUsers',
            select: 'name email avatar'
          }
        ]
      })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean(); // Convert to plain JavaScript objects for better performance

    console.log(`📥 Fetched ${posts.length} posts from database (following-based feed)`);

    // Count total documents (can be cached for even better performance)
    const total = await Post.countDocuments({ 
      visibility: 'public',
      author: { 
        $in: allAllowedAuthorIds,
        $nin: blockedUserIds
      }
    });

    // Add virtual fields manually since lean() removes them
    const postsWithVirtuals = posts.map(post => {
      const commentsArray = post.comments || [];
      const reactionsArray = post.reactions || [];
      
      // Debug logging for first post
      if (posts.indexOf(post) === 0) {
        console.log('📊 Sample Post Data:');
        console.log('  Comments array length:', commentsArray.length);
        console.log('  Reactions array length:', reactionsArray.length);
        console.log('  Post ID:', post._id);
        console.log('  Is Reshare:', post.isReshare);
        console.log('  Has Original Post:', !!post.originalPost);
      }
      
      // For reshared posts, format for frontend compatibility
      if (post.isReshare && post.originalPost) {
        const originalReactions = post.originalPost.reactions || [];
        const originalComments = post.originalPost.comments || [];
        
        return {
          ...post.originalPost, // Use original post's data as the main content
          _id: post._id, // Keep reshared post's ID
          // Add reshare metadata
          isShared: true, // Frontend expects 'isShared'
          isReshare: true, // Keep for API consistency
          sharedBy: post.author, // Who reshared it
          shareMessage: post.reshareCaption || '', // Caption added when resharing
          resharedAt: post.createdAt, // When it was reshared
          originalPostId: post.originalPost._id,
          // Counts from original post
          reactionsCount: originalReactions.length,
          likesCount: originalReactions.length,
          commentsCount: originalComments.length,
          reactionsSummary: originalReactions.reduce((acc, r) => {
            acc[r.type] = (acc[r.type] || 0) + 1;
            return acc;
          }, {}),
          // Remove full comments array to reduce payload size
          comments: undefined
        };
      }
      
      // For regular posts
      return {
        ...post,
        isShared: false,
        reactionsCount: reactionsArray.length,
        likesCount: reactionsArray.length,
        commentsCount: commentsArray.length,
        reactionsSummary: reactionsArray.reduce((acc, r) => {
          acc[r.type] = (acc[r.type] || 0) + 1;
          return acc;
        }, {}),
        // Remove full comments array to reduce payload size
        comments: undefined
      };
    });

    res.status(200).json({
      success: true,
      message: 'Posts retrieved successfully',
      data: {
        posts: postsWithVirtuals,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve posts'
    });
  }
});

// @route   GET /api/posts/:id
// @desc    Get single post by ID
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    // Validate ObjectId format
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid post ID format'
      });
    }

    const post = await Post.findById(req.params.id)
      .populate('author', 'name email avatar isPremium premiumFeatures')
      .populate('taggedUsers', 'name email avatar')
      .populate({
        path: 'originalPost',
        select: 'content author images videos mediaType reactions comments createdAt taggedUsers',
        populate: [
          {
            path: 'author',
            select: 'name email avatar'
          },
          {
            path: 'taggedUsers',
            select: 'name email avatar'
          }
        ]
      })
      .populate({
        path: 'comments.user',
        select: 'name email avatar'
      })
      .populate({
        path: 'comments.taggedUsers',
        select: 'name email avatar'
      })
      .populate({
        path: 'comments.replies.user',
        select: 'name email avatar'
      })
      .populate({
        path: 'comments.replies.taggedUsers',
        select: 'name email avatar'
      })
      .populate({
        path: 'comments.replies.mentionedUser',
        select: 'name email avatar'
      })
      .populate({
        path: 'comments.replies.replies.user',
        select: 'name email avatar'
      })
      .populate({
        path: 'comments.replies.replies.taggedUsers',
        select: 'name email avatar'
      })
      .populate({
        path: 'comments.replies.replies.mentionedUser',
        select: 'name email avatar'
      });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Post retrieved successfully',
      data: { post }
    });
  } catch (error) {
    console.error('Get post error:', error);
    
    // Handle specific cast errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post ID or corrupted data in post'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve post'
    });
  }
});

// @route   POST /api/posts
// @desc    Create a new post with text, images, and/or videos
// @access  Private
router.post('/', createContentLimiter, upload.array('media', 10), async (req, res) => {
  try {
    console.log('📝 Creating post with body:', req.body);
    console.log('📝 Files received:', req.files?.length || 0);
    
    const { content, visibility, taggedUsers } = req.body;

    // Validate content
    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Post content is required'
      });
    }

    if (content.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Post content cannot exceed 5000 characters'
      });
    }

    // Process tagged users - only allow tagging followers
    let taggedUserIds = [];
    
    // First, parse @mentions from content
    const User = require('../models/User');
    const currentUser = await User.findById(req.user._id).select('followers');
    const followerIds = currentUser.followers.map(id => id.toString());
    
    // Extract @mentions from content (e.g., @John Doe)
    const mentionRegex = /@([A-Za-z]+(?:\s+[A-Za-z]+)*)/g;
    const mentions = [];
    let match;
    
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]); // The name after @
    }
    
    if (mentions.length > 0) {
      console.log('� Found @mentions in content:', mentions);
      
      // Find users by name who are also followers
      const mentionedUsers = await User.find({
        name: { $in: mentions },
        _id: { $in: currentUser.followers }
      }).select('_id name');
      
      console.log('👥 Matched mentioned users:', mentionedUsers.map(u => ({ id: u._id, name: u.name })));
      taggedUserIds = mentionedUsers.map(u => u._id);
    }
    
    // Then, merge with manually tagged users
    if (taggedUsers) {
      try {
        console.log('👥 Processing manually tagged users:', taggedUsers);
        const manualTagIds = typeof taggedUsers === 'string' ? JSON.parse(taggedUsers) : taggedUsers;
        console.log('👥 Parsed tagged user IDs:', manualTagIds);
        
        // Filter manual tags to only include followers
        const filteredManualTagIds = manualTagIds.filter(userId => 
          followerIds.includes(userId.toString())
        );
        console.log('👥 Filtered manual tag IDs (followers only):', filteredManualTagIds);
        
        // Validate that users exist in database
        const validUsers = await User.find({ 
          _id: { $in: filteredManualTagIds }
        }).select('_id');
        console.log('👥 Valid manually tagged users:', validUsers.map(u => u._id));
        
        // Merge with mentioned users (avoid duplicates)
        validUsers.forEach(user => {
          if (!taggedUserIds.some(id => id.toString() === user._id.toString())) {
            taggedUserIds.push(user._id);
          }
        });
        
        // Log if some users were filtered out
        if (validUsers.length < manualTagIds.length) {
          console.log('⚠️ Some manually tagged users were filtered out (not followers or not found)');
        }
      } catch (e) {
        console.error('❌ Error processing manually tagged users:', e);
      }
    }
    
    console.log('✅ Final tagged user IDs:', taggedUserIds);

    // Process uploaded files
    const images = [];
    const videos = [];
    
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        const filePath = `/uploads/${file.filename}`;
        if (file.mimetype.startsWith('image/')) {
          images.push(filePath);
        } else if (file.mimetype.startsWith('video/')) {
          videos.push(filePath);
        }
      });
    }

    // Determine media type
    let mediaType = 'text';
    if (images.length > 0 && videos.length > 0) {
      mediaType = 'mixed';
    } else if (images.length > 0) {
      mediaType = 'image';
    } else if (videos.length > 0) {
      mediaType = 'video';
    }

    const post = new Post({
      content: content.trim(),
      author: req.user._id,
      images,
      videos,
      mediaType,
      visibility: visibility || 'public',
      taggedUsers: taggedUserIds
    });

    await post.save();
    
    // Populate author information and tagged users
    await post.populate('author', 'name email avatar isPremium premiumFeatures');
    await post.populate('taggedUsers', 'name email avatar');

    // Create notifications for tagged users
    if (taggedUserIds.length > 0) {
      const Notification = require('../models/Notification');
      
      console.log(`🔔 Creating notifications for ${taggedUserIds.length} tagged users`);
      
      for (const taggedUserId of taggedUserIds) {
        // Don't notify the author if they tagged themselves
        if (taggedUserId.toString() !== req.user._id.toString()) {
          console.log(`🔔 Creating notification for user ${taggedUserId}`);
          await Notification.create({
            recipient: taggedUserId,
            sender: req.user._id,
            type: 'tag',
            post: post._id,
            message: `${req.user.name} tagged you in a post`
          });
          console.log(`✅ Notification created for user ${taggedUserId}`);
        } else {
          console.log(`⏭️ Skipping notification for self-tag (user ${taggedUserId})`);
        }
      }
    }

    // Emit Socket.IO event for new post - only to users who follow the author
    const io = req.app.get('io');
    if (io) {
      // Get the author's followers
      const User = require('../models/User');
      const author = await User.findById(req.user._id).select('followers');
      const followerIds = author.followers || [];
      
      // Emit to each follower individually
      followerIds.forEach(followerId => {
        io.to(`user:${followerId}`).emit('post:created', {
          post: post.toObject(),
          author: req.user._id
        });
      });
      
      console.log(`📡 Emitted post:created to ${followerIds.length} followers`);

      // Emit real-time notifications to tagged users
      if (taggedUserIds.length > 0) {
        console.log(`📡 Emitting notifications to ${taggedUserIds.length} tagged users`);
        
        for (const taggedUserId of taggedUserIds) {
          if (taggedUserId.toString() !== req.user._id.toString()) {
            console.log(`📡 Fetching notification for user ${taggedUserId}`);
            
            // Get the full notification with populated fields
            const notification = await Notification.findOne({
              recipient: taggedUserId,
              sender: req.user._id,
              post: post._id,
              type: 'tag'
            })
              .populate('sender', 'name email avatar')
              .populate('post', 'content images videos')
              .sort({ createdAt: -1 })
              .limit(1);

            if (notification) {
              console.log(`📡 Found notification, emitting to room: user:${taggedUserId}`);
              io.to(`user:${taggedUserId}`).emit('notification:new', {
                notification: notification.toObject()
              });
              console.log(`✅ Sent tag notification to user ${taggedUserId}`);
            } else {
              console.log(`❌ No notification found for user ${taggedUserId}`);
            }
          } else {
            console.log(`⏭️ Skipping socket emit for self-tag (user ${taggedUserId})`);
          }
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      data: { post }
    });
  } catch (error) {
    console.error('❌ Create post error:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error message:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create post',
      error: error.message
    });
  }
});

// @route   PUT /api/posts/:id
// @desc    Update a post
// @access  Private
router.put('/:id', createPostValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user is the author
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit your own posts'
      });
    }

    const { content, images, visibility } = req.body;

    post.content = content;
    if (images) post.images = images;
    if (visibility) post.visibility = visibility;

    await post.save();
    await post.populate('author', 'name email avatar isPremium premiumFeatures');

    // Emit socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('post:updated', {
        postId: post._id,
        content: post.content,
        updatedAt: post.updatedAt,
        authorId: post.author._id
      });
      console.log('✏️ Emitted post:updated event for post:', post._id);
    }

    res.status(200).json({
      success: true,
      message: 'Post updated successfully',
      data: { post }
    });
  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update post'
    });
  }
});

// @route   DELETE /api/posts/:id
// @desc    Delete a post
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user is the author
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own posts'
      });
    }

    await Post.findByIdAndDelete(req.params.id);

    // Emit socket event for real-time update - only to users who follow the author
    const io = req.app.get('io');
    if (io) {
      // Get the author's followers
      const User = require('../models/User');
      const author = await User.findById(req.user._id).select('followers');
      const followerIds = author.followers || [];
      
      // Emit to each follower individually
      followerIds.forEach(followerId => {
        io.to(`user:${followerId}`).emit('post:deleted', {
          postId: req.params.id
        });
      });
      
      console.log(`📡 Emitted post:deleted to ${followerIds.length} followers`);
    }

    res.status(200).json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete post'
    });
  }
});

// @route   PUT /api/posts/:id
// @desc    Edit/update a post
// @access  Private
router.put('/:id', [
  body('content')
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Post content cannot exceed 5000 characters')
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

    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user is the author
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit your own posts'
      });
    }

    // Update content if provided
    if (req.body.content !== undefined) {
      post.content = req.body.content;
    }

    await post.save();

    // Populate author info
    await post.populate('author', 'name email avatar isPremium premiumFeatures');

    // Emit socket event for real-time update - only to users who follow the author
    const io = req.app.get('io');
    if (io) {
      // Get the author's followers
      const User = require('../models/User');
      const author = await User.findById(req.user._id).select('followers');
      const followerIds = author.followers || [];
      
      // Emit to each follower individually
      followerIds.forEach(followerId => {
        io.to(`user:${followerId}`).emit('post:updated', {
          postId: post._id.toString(),
          content: post.content,
          updatedAt: post.updatedAt
        });
      });
      
      console.log(`📡 Emitted post:updated to ${followerIds.length} followers`);
    }

    res.status(200).json({
      success: true,
      message: 'Post updated successfully',
      data: { post }
    });
  } catch (error) {
    console.error('Edit post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update post'
    });
  }
});

// @route   POST /api/posts/:id/share
// @desc    Share a post to feed or to followers via message
// @access  Private
router.post('/:id/share', async (req, res) => {
  try {
    const { shareType, recipients, message } = req.body;
    // shareType: 'feed' or 'message'
    // recipients: array of user IDs (only for message type)
    // message: optional message to include with the share

    const post = await Post.findById(req.params.id).populate('author', 'name email avatar isPremium premiumFeatures');

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user has access to this post
    const Block = require('../models/Block');
    const isBlocked = await Block.isBlocked(req.user._id, post.author._id);
    
    if (isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Cannot share this post'
      });
    }

    const User = require('../models/User');
    const currentUser = await User.findById(req.user._id).select('name avatar followers');

    console.log(`🔍 DEBUG - Current User ID: ${req.user._id}`);
    console.log(`🔍 DEBUG - Current User Name: ${currentUser?.name}`);
    console.log(`🔍 DEBUG - Followers Array:`, currentUser?.followers);
    console.log(`🔍 DEBUG - Followers Length:`, currentUser?.followers?.length);
    console.log(`🔍 DEBUG - Share Type:`, shareType);

    if (shareType === 'feed') {
      // Share to user's feed by creating a new reshared post
      // Create a new post that references the original
      const resharedPost = await Post.create({
        isReshare: true, // Set this first so validation knows content is optional
        originalPost: post._id,
        content: message || '', // Optional caption
        author: req.user._id,
        visibility: 'public',
        reshareCaption: message || null,
        mediaType: 'text' // Reshared posts are treated as text posts with embedded original
      });

      // Add share record to original post
      if (!post.shares) {
        post.shares = [];
      }
      post.shares.push({
        user: req.user._id,
        sharedAt: new Date(),
        shareType: 'feed'
      });
      await post.save();

      // Populate the reshared post with author and original post details
      await resharedPost.populate('author', 'name email avatar isPremium premiumFeatures');
      await resharedPost.populate({
        path: 'originalPost',
        select: 'content author images videos mediaType reactions comments createdAt',
        populate: {
          path: 'author',
          select: 'name email avatar'
        }
      });

      // Emit to all followers via socket
      const io = req.app.get('io');
      const followerCount = currentUser.followers ? currentUser.followers.length : 0;
      
      console.log(`📊 Reshare Debug - User: ${currentUser.name}, Followers count: ${followerCount}`);
      console.log(`📊 Reshared Post ID: ${resharedPost._id}`);
      console.log(`📊 Original Post ID: ${post._id}`);
      console.log(`📊 Original Post populated: ${!!resharedPost.originalPost}`);
      
      if (io && currentUser.followers && currentUser.followers.length > 0) {
        // Format the reshared post for real-time display (same as feed API)
        const originalPostObj = resharedPost.originalPost.toObject ? resharedPost.originalPost.toObject() : resharedPost.originalPost;
        const originalReactions = originalPostObj.reactions || [];
        const originalComments = originalPostObj.comments || [];
        
        const formattedPost = {
          ...originalPostObj, // Use original post's content, images, videos
          _id: resharedPost._id, // But keep the reshared post's ID
          // Add reshare metadata
          isShared: true,
          isReshare: true,
          sharedBy: {
            _id: req.user._id,
            name: currentUser.name,
            avatar: currentUser.avatar
          },
          shareMessage: resharedPost.reshareCaption || '',
          resharedAt: resharedPost.createdAt,
          originalPostId: originalPostObj._id,
          // Stats from original post
          reactionsCount: originalReactions.length,
          likesCount: originalReactions.length,
          commentsCount: originalComments.length,
          reactionsSummary: originalReactions.reduce((acc, r) => {
            acc[r.type] = (acc[r.type] || 0) + 1;
            return acc;
          }, {}),
          // Remove full comments array
          comments: undefined
        };

        console.log(`📤 Formatted reshared post for socket:`);
        console.log(`   - Has content: ${!!formattedPost.content}`);
        console.log(`   - Has images: ${formattedPost.images?.length || 0}`);
        console.log(`   - Has videos: ${formattedPost.videos?.length || 0}`);
        console.log(`   - Original author: ${formattedPost.author?.name}`);
        console.log(`   - Reshared by: ${currentUser.name}`);

        const shareData = {
          post: formattedPost,
          sharedBy: {
            _id: req.user._id,
            name: currentUser.name,
            avatar: currentUser.avatar
          },
          sharedAt: new Date(),
          message: resharedPost.reshareCaption || ''
        };

        currentUser.followers.forEach(followerId => {
          io.to(`user:${followerId}`).emit('post:shared', shareData);
          console.log(`   → Notified follower: ${followerId}`);
        });

        console.log(`📤 Post reshared to feed - notified ${followerCount} followers`);
      } else {
        console.log(`⚠️ No followers to notify or no socket connection`);
      }

      // Create notification for the original post author (if different user)
      if (post.author._id.toString() !== req.user._id.toString()) {
        const notification = await Notification.create({
          recipient: post.author._id,
          sender: req.user._id,
          type: 'post_share',
          message: `${currentUser.name} reshared your post`,
          post: post._id
        });

        // Populate sender for notification
        await notification.populate('sender', 'name avatar');

        // Emit notification via socket with full details
        if (io) {
          const notificationData = {
            _id: notification._id,
            type: 'post_share',
            message: `reshared your post`,
            sender: {
              _id: req.user._id,
              name: currentUser.name,
              avatar: currentUser.avatar
            },
            post: {
              _id: post._id,
              content: post.content?.substring(0, 50) || '',
              images: post.images?.[0] || null
            },
            isRead: false,
            createdAt: notification.createdAt
          };

          // Emit with 'notification' wrapper for homepage listener
          io.to(`user:${post.author._id}`).emit('notification:new', {
            notification: notificationData,
            // Also include flat structure for GlobalNotificationService
            ...notificationData
          });
          
          // Get updated unread count for the post author
          const unreadCount = await Notification.countDocuments({
            recipient: post.author._id,
            isRead: false
          });
          
          // Emit unread count update
          io.to(`user:${post.author._id}`).emit('notification:unread-count', {
            unreadCount
          });
          
          console.log(`🔔 Post reshare notification sent to user:${post.author._id}, unread count: ${unreadCount}`);
          console.log(`   Type: post_share`);
          console.log(`   Sender: ${currentUser.name}`);
          console.log(`   Socket room: user:${post.author._id}`);
        } else {
          console.log(`⚠️ No socket connection - notification saved to DB only`);
        }
      }

      return res.status(200).json({
        success: true,
        message: `Post reshared to your feed (${followerCount} followers notified)`,
        data: { 
          shareType: 'feed', 
          resharedPost: resharedPost,
          originalAuthorNotified: post.author._id.toString() !== req.user._id.toString(),
          followerCount: followerCount, // Flutter expects 'followerCount'
          followersNotified: followerCount // Keep for backward compatibility
        }
      });

    } else if (shareType === 'message') {
      // Share to specific users via messages
      if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Recipients are required for message sharing'
        });
      }

      const Message = require('../models/Message');
      const Conversation = require('../models/Conversation');
      const sentMessages = [];

      // Send to each recipient
      for (const recipientId of recipients) {
        // Check if blocked
        const isBlockedRecipient = await Block.isBlocked(req.user._id, recipientId);
        if (isBlockedRecipient) {
          continue; // Skip blocked users
        }

        // Find or create conversation
        const conversation = await Conversation.findOrCreate(req.user._id, recipientId);

        // Create shared post message
        const newMessage = await Message.create({
          conversation: conversation._id,
          sender: req.user._id,
          recipient: recipientId,
          content: message || `Shared a post by ${post.author.name}`,
          type: 'shared_post',
          sharedPost: post._id
        });

        // Update conversation
        conversation.lastMessage = newMessage._id;
        conversation.lastMessageAt = newMessage.createdAt;
        await conversation.incrementUnread(recipientId);

        // Populate message
        await newMessage.populate('sender', 'name email avatar');
        await newMessage.populate('recipient', 'name email avatar');
        await newMessage.populate({
          path: 'sharedPost',
          select: 'content author images videos createdAt',
          populate: {
            path: 'author',
            select: 'name avatar'
          }
        });

        sentMessages.push(newMessage);

        // Emit socket event to recipient
        const io = req.app.get('io');
        if (io) {
          const messageData = {
            _id: newMessage._id,
            conversation: conversation._id,
            sender: {
              _id: req.user._id,
              name: currentUser.name,
              avatar: currentUser.avatar
            },
            recipient: newMessage.recipient,
            content: newMessage.content,
            type: 'shared_post',
            sharedPost: newMessage.sharedPost,
            isRead: false,
            createdAt: newMessage.createdAt
          };

          io.to(`user:${recipientId}`).emit('message:new', {
            message: messageData
          });

          // Send to sender's room too
          io.to(`user:${req.user._id}`).emit('message:new', {
            message: messageData
          });

          // Update unread count
          const recipientUnreadCount = conversation.getUnreadCount(recipientId);
          io.to(`user:${recipientId}`).emit('message:unread-count', {
            conversationId: conversation._id.toString(),
            unreadCount: recipientUnreadCount,
            increment: 1
          });

          console.log(`💬 Shared post sent to user: ${recipientId}`);
        }

        // Create notification
        await Notification.create({
          recipient: recipientId,
          sender: req.user._id,
          type: 'message',
          message: `Shared a post with you`,
          conversation: conversation._id
        });
      }

      // Add share record to post for each recipient
      // Initialize shares array if it doesn't exist
      if (!post.shares) {
        post.shares = [];
      }
      const shareRecords = recipients.map(recipientId => ({
        user: req.user._id,
        sharedAt: new Date(),
        shareType: 'message'
      }));
      post.shares.push(...shareRecords);
      await post.save();

      return res.status(200).json({
        success: true,
        message: 'Post shared via messages',
        data: { 
          shareType: 'message', 
          recipientCount: sentMessages.length,
          messages: sentMessages
        }
      });

    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid share type. Must be "feed" or "message"'
      });
    }

  } catch (error) {
    console.error('Share post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share post',
      error: error.message
    });
  }
});

// @route   GET /api/posts/saved/search
// @desc    Search user's saved posts by content
// @access  Private
router.get('/saved/search', async (req, res) => {
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

    // Get user with saved posts
    const User = require('../models/User');
    const user = await User.findById(req.user._id).select('savedPosts');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Search within user's saved posts by content (case-insensitive)
    const searchRegex = new RegExp(searchQuery, 'i');
    const posts = await Post.find({
      _id: { $in: user.savedPosts },
      content: searchRegex,
      visibility: 'public'
    })
      .select('content author images videos reactions comments createdAt isReshare originalPost reshareCaption mediaType')
      .populate('author', 'name email avatar isPremium premiumFeatures')
      .populate({
        path: 'originalPost',
        select: 'content author images videos mediaType reactions comments createdAt',
        populate: {
          path: 'author',
          select: 'name email avatar'
        }
      })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    // Get total count for pagination
    const total = await Post.countDocuments({
      _id: { $in: user.savedPosts },
      content: searchRegex,
      visibility: 'public'
    });

    // Format posts
    const formattedPosts = posts.map(post => {
      const commentsArray = post.comments || [];
      const reactionsArray = post.reactions || [];
      
      return {
        ...post,
        likesCount: reactionsArray.length,
        reactionsCount: reactionsArray.length,
        commentsCount: commentsArray.length,
        comments: undefined
      };
    });

    console.log(`🔍 Search for "${searchQuery}" found ${posts.length} saved posts`);

    res.status(200).json({
      success: true,
      data: {
        posts: formattedPosts,
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
    console.error('Search saved posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search saved posts'
    });
  }
});

// @route   POST /api/posts/:id/save
// @desc    Save/unsave a post (toggle bookmark)
// @access  Private
router.post('/:id/save', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const User = require('../models/User');
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if post is already saved
    const isSaved = user.savedPosts.includes(req.params.id);

    if (isSaved) {
      // Unsave the post
      user.savedPosts = user.savedPosts.filter(
        postId => postId.toString() !== req.params.id
      );
      await user.save();

      res.status(200).json({
        success: true,
        message: 'Post removed from saved posts',
        data: { saved: false }
      });
    } else {
      // Save the post
      user.savedPosts.push(req.params.id);
      await user.save();

      res.status(200).json({
        success: true,
        message: 'Post saved successfully',
        data: { saved: true }
      });
    }
  } catch (error) {
    console.error('Save post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save post'
    });
  }
});

// @route   POST /api/posts/:id/report
// @desc    Report a post
// @access  Private
router.post('/:id/report', [
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

    const post = await Post.findById(req.params.id).populate('author', 'name email');

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const { reason, details } = req.body;

    // Save report to database
    const Report = require('../models/Report');
    const report = new Report({
      reportType: 'post',
      reportedPost: req.params.id,
      reporter: req.user._id,
      reason,
      details: details || '',
      status: 'pending'
    });
    await report.save();

    console.log(`🚨 Post report saved to database`);
    console.log(`   Report ID: ${report._id}`);
    console.log(`   Post ID: ${req.params.id}`);
    console.log(`   Post Author: ${post.author?.name || 'Unknown'}`);
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
    console.error('Report post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit report'
    });
  }
});

// @route   POST /api/posts/:id/react
// @desc    Add or update reaction to a post
// @access  Private
router.post('/:id/react', [
  body('reactionType')
    .isIn(['like', 'celebrate', 'insightful', 'funny', 'mindblown', 'support'])
    .withMessage('Invalid reaction type')
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

    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const { reactionType } = req.body;
    await post.addReaction(req.user._id, reactionType);

    // Populate post author to get recipient info
    await post.populate('author', 'name email avatar isPremium premiumFeatures');

    // Create notification for post author (if not reacting to own post)
    if (post.author._id.toString() !== req.user._id.toString()) {
      const notification = await Notification.createNotification({
        recipient: post.author._id,
        sender: req.user._id,
        type: 'reaction',
        post: post._id,
        reactionType
      });

      if (notification) {
        await notification.populate('sender', 'name email avatar');
        
        // Emit Socket.IO event for notification
        const io = req.app.get('io');
        if (io) {
          io.to(`user:${post.author._id}`).emit('notification:new', {
            notification: notification.toObject()
          });
          
          // Get updated unread count for the post author
          const unreadCount = await Notification.countDocuments({
            recipient: post.author._id,
            isRead: false
          });
          
          // Emit unread count update
          io.to(`user:${post.author._id}`).emit('notification:unread-count', {
            unreadCount
          });
          
          console.log(`🔔 Post reaction notification sent to user:${post.author._id}, unread count: ${unreadCount}`);
        }
      }
    }

    // Emit Socket.IO event for reaction
    const io = req.app.get('io');
    if (io) {
      io.emit('post:reacted', {
        postId: post._id,
        userId: req.user._id,
        reactionType,
        reactionsCount: post.reactionsCount,
        reactionsSummary: post.reactionsSummary
      });
    }

    res.status(200).json({
      success: true,
      message: 'Reaction added successfully',
      data: {
        reactionsCount: post.reactionsCount,
        reactionsSummary: post.reactionsSummary,
        userReaction: reactionType
      }
    });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reaction'
    });
  }
});

// @route   DELETE /api/posts/:id/react
// @desc    Remove reaction from a post
// @access  Private
router.delete('/:id/react', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    await post.removeReaction(req.user._id);

    // Emit Socket.IO event for reaction removal
    const io = req.app.get('io');
    if (io) {
      io.emit('post:reacted', {
        postId: post._id,
        userId: req.user._id,
        reactionType: null,
        reactionsCount: post.reactionsCount,
        reactionsSummary: post.reactionsSummary
      });
    }

    res.status(200).json({
      success: true,
      message: 'Reaction removed successfully',
      data: {
        reactionsCount: post.reactionsCount,
        reactionsSummary: post.reactionsSummary,
        userReaction: null
      }
    });
  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove reaction'
    });
  }
});

// @route   GET /api/posts/:id/reactions
// @desc    Get all reactions for a post
// @access  Private
router.get('/:id/reactions', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('reactions.user', 'name email avatar')
      .lean();

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Format reactions with user info
    const reactions = (post.reactions || []).map(reaction => ({
      _id: reaction._id,
      type: reaction.type,
      user: reaction.user,
      createdAt: reaction.createdAt
    }));

    res.status(200).json({
      success: true,
      data: {
        reactions,
        reactionsSummary: post.reactionsSummary,
        totalReactions: post.reactionsCount
      }
    });
  } catch (error) {
    console.error('Get reactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get reactions'
    });
  }
});

// @route   POST /api/posts/:id/like (Legacy support)
// @desc    Like a post (converts to 'like' reaction)
// @access  Private
router.post('/:id/like', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    await post.addReaction(req.user._id, 'like');

    res.status(200).json({
      success: true,
      message: 'Post liked successfully',
      data: {
        likesCount: post.likesCount,
        isLiked: true
      }
    });
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to like post'
    });
  }
});

// @route   DELETE /api/posts/:id/like (Legacy support)
// @desc    Unlike a post
// @access  Private
router.delete('/:id/like', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    await post.removeReaction(req.user._id);

    res.status(200).json({
      success: true,
      message: 'Post unliked successfully',
      data: {
        likesCount: post.likesCount,
        isLiked: false
      }
    });
  } catch (error) {
    console.error('Unlike post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unlike post'
    });
  }
});

// @route   POST /api/posts/:id/comments
// @desc    Add a comment to a post
// @access  Private
router.post('/:id/comments', commentValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const { content, gif } = req.body;
    
    // Parse @mentions from comment content
    const User = require('../models/User');
    const currentUser = await User.findById(req.user._id).select('followers following');
    const followerIds = currentUser.followers.map(id => id.toString());
    const followingIds = currentUser.following.map(id => id.toString());
    // Allow mentioning users you follow OR users who follow you
    const allowedUserIds = [...new Set([...followerIds, ...followingIds])];
    
    const mentionRegex = /@([A-Za-z]+(?:\s+[A-Za-z]+)*)/g;
    const mentions = [];
    let match;
    
    if (content) {
      while ((match = mentionRegex.exec(content)) !== null) {
        mentions.push(match[1]);
      }
    }
    
    let mentionedUserIds = [];
    if (mentions.length > 0) {
      console.log('💬 Found @mentions in comment:', mentions);
      console.log('💬 Allowed users (followers + following):', allowedUserIds.length);
      
      const mentionedUsers = await User.find({
        name: { $in: mentions },
        _id: { $in: allowedUserIds }
      }).select('_id name');
      
      console.log('👥 Matched mentioned users in comment:', mentionedUsers.map(u => ({ id: u._id, name: u.name })));
      mentionedUserIds = mentionedUsers.map(u => u._id);
      
      // Log if no matches found
      if (mentionedUserIds.length === 0) {
        console.log('⚠️ WARNING: No mentioned users matched! Users must be in your followers or following list.');
      }
    }
    
    // Create comment with optional GIF
    const commentData = {
      user: req.user._id,
      content: content || '',
      gif: gif || null,
      taggedUsers: mentionedUserIds, // Store mentioned users
      createdAt: new Date()
    };
    
    post.comments.push(commentData);
    await post.save();
    await post.populate('comments.user', 'name email avatar');
    await post.populate('comments.taggedUsers', 'name email avatar');
    await post.populate('author', 'name email avatar isPremium premiumFeatures');

    const newComment = post.comments[post.comments.length - 1];

    // Create notification for post author (if not commenting on own post)
    if (post.author._id.toString() !== req.user._id.toString()) {
      console.log(`📢 Creating notification for user ${post.author._id}`);
      const notification = await Notification.createNotification({
        recipient: post.author._id,
        sender: req.user._id,
        type: 'comment',
        post: post._id,
        commentText: gif ? '🎞️ Sent a GIF' : (content ? content.substring(0, 100) : '') // Preview of comment
      });

      if (notification) {
        await notification.populate('sender', 'name email avatar');
        
        // Emit Socket.IO event for notification
        const io = req.app.get('io');
        if (io) {
          const roomName = `user:${post.author._id}`;
          console.log(`📢 Emitting notification:new to room: ${roomName}`);
          console.log(`📢 Notification data:`, notification.toObject());
          io.to(roomName).emit('notification:new', {
            notification: notification.toObject()
          });
          
          // Get updated unread count for the post author
          const unreadCount = await Notification.countDocuments({
            recipient: post.author._id,
            isRead: false
          });
          
          // Emit unread count update
          io.to(roomName).emit('notification:unread-count', {
            unreadCount
          });
          
          console.log(`✅ Comment notification emitted successfully with unread count: ${unreadCount}`);
          
          // If recipient is not connected via socket, send FCM push notification
          const userSockets = req.app.get('userSockets');
          const recipientSockets = userSockets?.get(post.author._id.toString());
          if (!recipientSockets || recipientSockets.size === 0) {
            console.log(`📱 Post author not connected via socket, sending FCM notification for comment`);
            const FCMService = require('../services/fcmService');
            await FCMService.sendNotificationToUser(
              post.author._id,
              `New comment from ${req.user.name}`,
              gif ? '🎞️ Sent a GIF comment' : (content ? content.substring(0, 100) : 'Commented on your post'),
              {
                postId: post._id.toString(),
                commentId: newComment._id.toString(),
                senderId: req.user._id.toString(),
                senderName: req.user.name,
                type: 'comment'
              }
            );
          } else {
            console.log(`📱 Post author is connected via socket, skipping FCM for comment`);
          }
        } else {
          console.log(`❌ Socket.IO instance not found`);
        }
      } else {
        console.log(`❌ Failed to create notification`);
      }
    } else {
      console.log(`⚠️ Skipping notification - user commenting on own post`);
    }

    // Create notifications for mentioned users in comment
    if (mentionedUserIds.length > 0) {
      const io = req.app.get('io');
      
      for (const mentionedUserId of mentionedUserIds) {
        // Don't notify if user mentioned themselves
        if (mentionedUserId.toString() !== req.user._id.toString()) {
          console.log(`💬 Creating mention notification for user ${mentionedUserId}`);
          
          const mentionNotification = await Notification.create({
            recipient: mentionedUserId,
            sender: req.user._id,
            type: 'tag',
            post: post._id,
            message: `${req.user.name} mentioned you in a comment`
          });

          await mentionNotification.populate('sender', 'name email avatar');
          await mentionNotification.populate('post', 'content images videos');
          
          // Emit real-time notification
          if (io) {
            io.to(`user:${mentionedUserId}`).emit('notification:new', {
              notification: mentionNotification.toObject()
            });
            
            // Get updated unread count
            const unreadCount = await Notification.countDocuments({
              recipient: mentionedUserId,
              isRead: false
            });
            
            // Emit unread count update
            io.to(`user:${mentionedUserId}`).emit('notification:unread-count', {
              unreadCount
            });
            
            console.log(`✅ Mention notification sent to user ${mentionedUserId}, unread count: ${unreadCount}`);
            
            // If mentioned user is not connected via socket, send FCM push notification
            const userSockets = req.app.get('userSockets');
            const mentionedUserSockets = userSockets?.get(mentionedUserId.toString());
            if (!mentionedUserSockets || mentionedUserSockets.size === 0) {
              console.log(`📱 Mentioned user not connected via socket, sending FCM notification for mention in comment`);
              const FCMService = require('../services/fcmService');
              await FCMService.sendNotificationToUser(
                mentionedUserId,
                `Mention from ${req.user.name}`,
                `${req.user.name} mentioned you in a comment`,
                {
                  postId: post._id.toString(),
                  commentId: newComment._id.toString(),
                  senderId: req.user._id.toString(),
                  senderName: req.user.name,
                  type: 'mention'
                }
              );
            } else {
              console.log(`📱 Mentioned user is connected via socket, skipping FCM for mention`);
            }
          }
        }
      }
    }

    // Emit Socket.IO event for new comment
    const io = req.app.get('io');
    if (io) {
      io.emit('post:commented', {
        postId: post._id,
        comment: newComment,
        commentsCount: post.commentsCount
      });
    }

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: {
        comment: newComment,
        commentsCount: post.commentsCount
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

// @route   POST /api/posts/:id/comments/:commentId/reply
// @desc    Add reply to a comment
// @access  Private
router.post('/:id/comments/:commentId/reply', commentValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const { content } = req.body;
    
    // Parse @mentions from reply content
    const User = require('../models/User');
    const currentUser = await User.findById(req.user._id).select('followers following');
    const followerIds = currentUser.followers.map(id => id.toString());
    const followingIds = currentUser.following.map(id => id.toString());
    // Allow mentioning users you follow OR users who follow you
    const allowedUserIds = [...new Set([...followerIds, ...followingIds])];
    
    const mentionRegex = /@([A-Za-z]+(?:\s+[A-Za-z]+)*)/g;
    const mentions = [];
    let match;
    
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]);
    }
    
    let mentionedUserIds = [];
    if (mentions.length > 0) {
      console.log('💬 Found @mentions in reply:', mentions);
      console.log('💬 Allowed users (followers + following):', allowedUserIds.length);
      
      const mentionedUsers = await User.find({
        name: { $in: mentions },
        _id: { $in: allowedUserIds }
      }).select('_id name');
      
      console.log('👥 Matched mentioned users in reply:', mentionedUsers.map(u => ({ id: u._id, name: u.name })));
      mentionedUserIds = mentionedUsers.map(u => u._id);
      
      if (mentionedUserIds.length === 0) {
        console.log('⚠️ WARNING: No mentioned users matched in reply!');
      }
    }
    
    const reply = {
      user: req.user._id,
      mentionedUser: comment.user, // Mention the comment author
      content,
      taggedUsers: mentionedUserIds,
      reactions: [],
      createdAt: new Date()
    };

    comment.replies.push(reply);
    await post.save();
    await post.populate('comments.user', 'name email avatar');
    await post.populate('comments.taggedUsers', 'name email avatar');
    await post.populate('comments.replies.user', 'name email avatar');
    await post.populate('comments.replies.taggedUsers', 'name email avatar');
    await post.populate('comments.replies.mentionedUser', 'name email avatar');

    const newReply = comment.replies[comment.replies.length - 1];

    // Create notification for the comment author (if not replying to own comment)
    // Extract user ID properly (handle both ObjectId and populated user object)
    const commentUserId = comment.user._id || comment.user;
    
    if (commentUserId.toString() !== req.user._id.toString()) {
      try {
        const notification = await Notification.create({
          recipient: commentUserId,
          sender: req.user._id,
          type: 'reply',
          post: post._id,
          commentText: content.substring(0, 100),
        });

        // Emit Socket.IO event for notification
        const io = req.app.get('io');
        if (io) {
          const roomName = `user:${commentUserId}`;
          console.log('🔔 EMITTING REPLY NOTIFICATION:');
          console.log('   To Room:', roomName);
          console.log('   Recipient ID:', commentUserId);
          console.log('   Sender:', req.user.name, `(${req.user._id})`);
          console.log('   Post ID:', post._id);
          
          io.to(roomName).emit('notification:new', {
            notification: {
              _id: notification._id,
              type: 'reply',
              sender: {
                _id: req.user._id,
                name: req.user.name,
                avatar: req.user.avatar
              },
              post: {
                _id: post._id,
                content: post.content
              },
              commentText: content.substring(0, 100),
              read: false,
              createdAt: notification.createdAt
            }
          });
          
          // Get updated unread count
          const unreadCount = await Notification.countDocuments({
            recipient: commentUserId,
            isRead: false
          });
          
          // Emit unread count update
          io.to(roomName).emit('notification:unread-count', {
            unreadCount
          });
          
          console.log(`✅ Reply notification emitted to room: ${roomName}, unread count: ${unreadCount}`);
          
          // If recipient is not connected via socket, send FCM push notification
          const userSockets = req.app.get('userSockets');
          const recipientSockets = userSockets?.get(commentUserId.toString());
          if (!recipientSockets || recipientSockets.size === 0) {
            console.log(`📱 Comment author not connected via socket, sending FCM notification for reply`);
            const FCMService = require('../services/fcmService');
            await FCMService.sendNotificationToUser(
              commentUserId,
              `New reply from ${req.user.name}`,
              content.substring(0, 100),
              {
                postId: post._id.toString(),
                commentId: req.params.commentId,
                replyId: newReply._id.toString(),
                senderId: req.user._id.toString(),
                senderName: req.user.name,
                type: 'reply'
              }
            );
          } else {
            console.log(`📱 Comment author is connected via socket, skipping FCM for reply`);
          }
        }
      } catch (notificationError) {
        console.error('Failed to create reply notification:', notificationError);
        // Don't fail the request if notification fails
      }
    }

    // Create notifications for mentioned users in reply
    if (mentionedUserIds.length > 0) {
      const io = req.app.get('io');
      
      for (const mentionedUserId of mentionedUserIds) {
        // Don't notify if user mentioned themselves or if they're the comment author (already notified)
        if (mentionedUserId.toString() !== req.user._id.toString() && 
            mentionedUserId.toString() !== commentUserId.toString()) {
          console.log(`💬 Creating mention notification in reply for user ${mentionedUserId}`);
          
          try {
            const mentionNotification = await Notification.create({
              recipient: mentionedUserId,
              sender: req.user._id,
              type: 'tag',
              post: post._id,
              message: `${req.user.name} mentioned you in a reply`
            });

            await mentionNotification.populate('sender', 'name email avatar');
            await mentionNotification.populate('post', 'content images videos');
            
            // Emit real-time notification
            if (io) {
              io.to(`user:${mentionedUserId}`).emit('notification:new', {
                notification: mentionNotification.toObject()
              });
              
              // Get updated unread count
              const unreadCount = await Notification.countDocuments({
                recipient: mentionedUserId,
                isRead: false
              });
              
              // Emit unread count update
              io.to(`user:${mentionedUserId}`).emit('notification:unread-count', {
                unreadCount
              });
              
              console.log(`✅ Reply mention notification sent to user ${mentionedUserId}, unread count: ${unreadCount}`);
              
              // If mentioned user is not connected via socket, send FCM push notification
              const userSockets = req.app.get('userSockets');
              const mentionedUserSockets = userSockets?.get(mentionedUserId.toString());
              if (!mentionedUserSockets || mentionedUserSockets.size === 0) {
                console.log(`📱 Mentioned user not connected via socket, sending FCM notification for mention in reply`);
                const FCMService = require('../services/fcmService');
                await FCMService.sendNotificationToUser(
                  mentionedUserId,
                  `Mention from ${req.user.name}`,
                  `${req.user.name} mentioned you in a reply`,
                  {
                    postId: post._id.toString(),
                    commentId: req.params.commentId,
                    replyId: newReply._id.toString(),
                    senderId: req.user._id.toString(),
                    senderName: req.user.name,
                    type: 'mention'
                  }
                );
              } else {
                console.log(`📱 Mentioned user is connected via socket, skipping FCM for mention in reply`);
              }
            }
          } catch (notificationError) {
            console.error('Failed to create mention notification in reply:', notificationError);
          }
        }
      }
    }

    // Emit Socket.IO event for new reply
    const io = req.app.get('io');
    if (io) {
      io.emit('comment:replied', {
        postId: post._id,
        commentId: comment._id,
        reply: newReply
      });
    }

    res.status(201).json({
      success: true,
      message: 'Reply added successfully',
      data: {
        reply: newReply,
        comment: comment
      }
    });
  } catch (error) {
    console.error('Add reply error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reply'
    });
  }
});

// @route   POST /api/posts/:id/comments/:commentId/react
// @desc    Add or update reaction to a comment
// @access  Private
router.post('/:id/comments/:commentId/react', async (req, res) => {
  try {
    const { reactionType } = req.body;
    
    if (!['like', 'love', 'haha', 'wow', 'sad', 'angry'].includes(reactionType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid reaction type'
      });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    // Check if user already reacted
    const existingReactionIndex = comment.reactions.findIndex(
      r => r.user.toString() === req.user._id.toString()
    );

    if (existingReactionIndex >= 0) {
      // Update existing reaction
      comment.reactions[existingReactionIndex].type = reactionType;
      comment.reactions[existingReactionIndex].createdAt = new Date();
    } else {
      // Add new reaction
      comment.reactions.push({
        user: req.user._id,
        type: reactionType,
        createdAt: new Date()
      });
    }

    await post.save();
    await post.populate('comments.user', 'name email avatar');
    await post.populate('comments.taggedUsers', 'name email avatar');

    // Create notification for comment author (if not reacting to own comment)
    const commentAuthorId = comment.user._id || comment.user;
    if (commentAuthorId.toString() !== req.user._id.toString()) {
      console.log(`💙 Creating reaction notification for comment author ${commentAuthorId}`);
      
      const notification = await Notification.create({
        recipient: commentAuthorId,
        sender: req.user._id,
        type: 'reaction',
        post: post._id,
        reactionType: reactionType,
        message: `${req.user.name} reacted ${reactionType} to your comment${comment.gif ? ' with GIF' : ''}`
      });

      await notification.populate('sender', 'name email avatar');
      await notification.populate('post', 'content images videos');
      
      // Emit real-time notification
      const io = req.app.get('io');
      if (io) {
        const roomName = `user:${commentAuthorId}`;
        console.log(`📢 Emitting reaction notification to room: ${roomName}`);
        io.to(roomName).emit('notification:new', {
          notification: notification.toObject()
        });
        
        // Get updated unread count
        const unreadCount = await Notification.countDocuments({
          recipient: commentAuthorId,
          isRead: false
        });
        
        // Emit unread count update
        io.to(roomName).emit('notification:unread-count', {
          unreadCount
        });
        
        console.log(`✅ Comment reaction notification sent, unread count: ${unreadCount}`);
        
        // If recipient is not connected via socket, send FCM push notification
        const userSockets = req.app.get('userSockets');
        const recipientSockets = userSockets?.get(commentAuthorId.toString());
        if (!recipientSockets || recipientSockets.size === 0) {
          console.log(`📱 Comment author not connected via socket, sending FCM notification for reaction`);
          const FCMService = require('../services/fcmService');
          await FCMService.sendNotificationToUser(
            commentAuthorId,
            `New reaction from ${req.user.name}`,
            `${req.user.name} reacted ${reactionType} to your comment${comment.gif ? ' with GIF' : ''}`,
            {
              postId: post._id.toString(),
              commentId: req.params.commentId,
              senderId: req.user._id.toString(),
              senderName: req.user.name,
              reactionType: reactionType,
              type: 'reaction'
            }
          );
        } else {
          console.log(`📱 Comment author is connected via socket, skipping FCM for reaction`);
        }
        
        // Also emit comment reaction event for UI updates
        io.emit('comment:reacted', {
          postId: post._id,
          commentId: comment._id,
          reaction: {
            user: req.user._id,
            type: reactionType
          }
        });
        console.log(`✅ Reaction notification sent successfully`);
      }
    } else {
      console.log(`⚠️ Skipping notification - user reacted to own comment`);
      
      // Still emit Socket.IO event for UI updates
      const io = req.app.get('io');
      if (io) {
        io.emit('comment:reacted', {
          postId: post._id,
          commentId: comment._id,
          reaction: {
            user: req.user._id,
            type: reactionType
          }
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Reaction added successfully',
      data: {
        reactions: comment.reactions
      }
    });
  } catch (error) {
    console.error('React to comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reaction'
    });
  }
});

// @route   DELETE /api/posts/:id/comments/:commentId/react
// @desc    Remove reaction from a comment
// @access  Private
router.delete('/:id/comments/:commentId/react', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    comment.reactions = comment.reactions.filter(
      r => r.user.toString() !== req.user._id.toString()
    );

    await post.save();

    // Emit Socket.IO event for removed reaction
    const io = req.app.get('io');
    if (io) {
      io.emit('comment:unreacted', {
        postId: post._id,
        commentId: comment._id,
        userId: req.user._id
      });
    }

    res.status(200).json({
      success: true,
      message: 'Reaction removed successfully',
      data: {
        reactions: comment.reactions
      }
    });
  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove reaction'
    });
  }
});

// @route   POST /api/posts/:id/comments/:commentId/replies/:replyId/react
// @desc    Add or update reaction to a reply
// @access  Private
router.post('/:id/comments/:commentId/replies/:replyId/react', async (req, res) => {
  try {
    const { reactionType } = req.body;
    
    if (!['like', 'love', 'haha', 'wow', 'sad', 'angry'].includes(reactionType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid reaction type'
      });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const reply = comment.replies.id(req.params.replyId);
    if (!reply) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found'
      });
    }

    // Check if user already reacted
    const existingReactionIndex = reply.reactions.findIndex(
      r => r.user.toString() === req.user._id.toString()
    );

    if (existingReactionIndex >= 0) {
      // Update existing reaction
      reply.reactions[existingReactionIndex].type = reactionType;
      reply.reactions[existingReactionIndex].createdAt = new Date();
    } else {
      // Add new reaction
      reply.reactions.push({
        user: req.user._id,
        type: reactionType,
        createdAt: new Date()
      });
    }

    await post.save();
    await post.populate('comments.replies.user', 'name email avatar');

    // Create notification for reply author (if not reacting to own reply)
    const replyAuthorId = reply.user._id || reply.user;
    if (replyAuthorId.toString() !== req.user._id.toString()) {
      console.log(`💙 Creating reaction notification for reply author ${replyAuthorId}`);
      
      const notification = await Notification.create({
        recipient: replyAuthorId,
        sender: req.user._id,
        type: 'reaction',
        post: post._id,
        reactionType: reactionType,
        message: `${req.user.name} reacted ${reactionType} to your reply`
      });

      await notification.populate('sender', 'name email avatar');
      await notification.populate('post', 'content images videos');
      
      // Emit real-time notification
      const io = req.app.get('io');
      if (io) {
        const roomName = `user:${replyAuthorId}`;
        console.log(`📢 Emitting reply reaction notification to room: ${roomName}`);
        io.to(roomName).emit('notification:new', {
          notification: notification.toObject()
        });
        
        // Get updated unread count
        const unreadCount = await Notification.countDocuments({
          recipient: replyAuthorId,
          isRead: false
        });
        
        // Emit unread count update
        io.to(roomName).emit('notification:unread-count', {
          unreadCount
        });
        
        console.log(`✅ Reply reaction notification sent, unread count: ${unreadCount}`);
        
        // If recipient is not connected via socket, send FCM push notification
        const userSockets = req.app.get('userSockets');
        const recipientSockets = userSockets?.get(replyAuthorId.toString());
        if (!recipientSockets || recipientSockets.size === 0) {
          console.log(`📱 Reply author not connected via socket, sending FCM notification for reaction`);
          const FCMService = require('../services/fcmService');
          await FCMService.sendNotificationToUser(
            replyAuthorId,
            `New reaction from ${req.user.name}`,
            `${req.user.name} reacted ${reactionType} to your reply`,
            {
              postId: post._id.toString(),
              commentId: req.params.commentId,
              replyId: req.params.replyId,
              senderId: req.user._id.toString(),
              senderName: req.user.name,
              reactionType: reactionType,
              type: 'reaction'
            }
          );
        } else {
          console.log(`📱 Reply author is connected via socket, skipping FCM for reaction`);
        }
      }
    }

    // Emit Socket.IO event
    const io = req.app.get('io');
    if (io) {
      io.emit('reply:reacted', {
        postId: post._id,
        commentId: comment._id,
        replyId: reply._id,
        reaction: {
          user: req.user._id,
          type: reactionType
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Reaction added to reply successfully',
      data: {
        reactions: reply.reactions
      }
    });
  } catch (error) {
    console.error('React to reply error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reaction to reply'
    });
  }
});

// @route   DELETE /api/posts/:id/comments/:commentId/replies/:replyId/react
// @desc    Remove reaction from a reply
// @access  Private
router.delete('/:id/comments/:commentId/replies/:replyId/react', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const reply = comment.replies.id(req.params.replyId);
    if (!reply) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found'
      });
    }

    reply.reactions = reply.reactions.filter(
      r => r.user.toString() !== req.user._id.toString()
    );

    await post.save();

    // Emit Socket.IO event
    const io = req.app.get('io');
    if (io) {
      io.emit('reply:unreacted', {
        postId: post._id,
        commentId: comment._id,
        replyId: reply._id,
        userId: req.user._id
      });
    }

    res.status(200).json({
      success: true,
      message: 'Reaction removed from reply successfully',
      data: {
        reactions: reply.reactions
      }
    });
  } catch (error) {
    console.error('Remove reply reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove reaction from reply'
    });
  }
});

// @route   POST /api/posts/:id/comments/:commentId/replies/:replyId/reply
// @desc    Add nested reply to a reply
// @access  Private
router.post('/:id/comments/:commentId/replies/:replyId/reply', commentValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const reply = comment.replies.id(req.params.replyId);
    if (!reply) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found'
      });
    }

    const { content } = req.body;
    
    // Parse @mentions from nested reply content
    const User = require('../models/User');
    const currentUser = await User.findById(req.user._id).select('followers following');
    const followerIds = currentUser.followers.map(id => id.toString());
    const followingIds = currentUser.following.map(id => id.toString());
    // Allow mentioning users you follow OR users who follow you
    const allowedUserIds = [...new Set([...followerIds, ...followingIds])];
    
    const mentionRegex = /@([A-Za-z]+(?:\s+[A-Za-z]+)*)/g;
    const mentions = [];
    let match;
    
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]);
    }
    
    let mentionedUserIds = [];
    if (mentions.length > 0) {
      console.log('💬 Found @mentions in nested reply:', mentions);
      console.log('💬 Allowed users (followers + following):', allowedUserIds.length);
      
      const mentionedUsers = await User.find({
        name: { $in: mentions },
        _id: { $in: allowedUserIds }
      }).select('_id name');
      
      console.log('👥 Matched mentioned users in nested reply:', mentionedUsers.map(u => ({ id: u._id, name: u.name })));
      mentionedUserIds = mentionedUsers.map(u => u._id);
      
      if (mentionedUserIds.length === 0) {
        console.log('⚠️ WARNING: No mentioned users matched in nested reply!');
      }
    }
    
    const nestedReply = {
      user: req.user._id,
      mentionedUser: reply.user, // Mention the reply author
      content,
      taggedUsers: mentionedUserIds,
      createdAt: new Date()
    };

    reply.replies.push(nestedReply);
    await post.save();
    await post.populate('comments.replies.replies.user', 'name email avatar');
    await post.populate('comments.replies.replies.taggedUsers', 'name email avatar');
    await post.populate('comments.replies.replies.mentionedUser', 'name email avatar');

    const newNestedReply = reply.replies[reply.replies.length - 1];

    // Create notification for the reply author (if not replying to own reply)
    // Extract user ID properly (handle both ObjectId and populated user object)
    const replyUserId = reply.user._id || reply.user;
    
    if (replyUserId.toString() !== req.user._id.toString()) {
      try {
        const notification = await Notification.create({
          recipient: replyUserId,
          sender: req.user._id,
          type: 'reply',
          post: post._id,
          commentText: content.substring(0, 100),
        });

        // Emit Socket.IO event for notification
        const io = req.app.get('io');
        if (io) {
          const roomName = `user:${replyUserId}`;
          console.log('🔔 EMITTING NESTED REPLY NOTIFICATION:');
          console.log('   To Room:', roomName);
          console.log('   Recipient ID:', replyUserId);
          console.log('   Sender:', req.user.name, `(${req.user._id})`);
          console.log('   Post ID:', post._id);
          
          io.to(roomName).emit('notification:new', {
            notification: {
              _id: notification._id,
              type: 'reply',
              sender: {
                _id: req.user._id,
                name: req.user.name,
                avatar: req.user.avatar
              },
              post: {
                _id: post._id,
                content: post.content
              },
              commentText: content.substring(0, 100),
              read: false,
              createdAt: notification.createdAt
            }
          });
          
          // Get updated unread count
          const unreadCount = await Notification.countDocuments({
            recipient: replyUserId,
            isRead: false
          });
          
          // Emit unread count update
          io.to(roomName).emit('notification:unread-count', {
            unreadCount
          });
          
          console.log(`✅ Nested reply notification emitted to room: ${roomName}, unread count: ${unreadCount}`);
        }
      } catch (notificationError) {
        console.error('Failed to create nested reply notification:', notificationError);
        // Don't fail the request if notification fails
      }
    }

    // Create notifications for mentioned users in nested reply
    if (mentionedUserIds.length > 0) {
      const io = req.app.get('io');
      
      for (const mentionedUserId of mentionedUserIds) {
        // Don't notify if user mentioned themselves or if they're the reply author (already notified)
        if (mentionedUserId.toString() !== req.user._id.toString() && 
            mentionedUserId.toString() !== replyUserId.toString()) {
          console.log(`💬 Creating mention notification in nested reply for user ${mentionedUserId}`);
          
          try {
            const mentionNotification = await Notification.create({
              recipient: mentionedUserId,
              sender: req.user._id,
              type: 'tag',
              post: post._id,
              message: `${req.user.name} mentioned you in a reply`
            });

            await mentionNotification.populate('sender', 'name email avatar');
            await mentionNotification.populate('post', 'content images videos');
            
            // Emit real-time notification
            if (io) {
              io.to(`user:${mentionedUserId}`).emit('notification:new', {
                notification: mentionNotification.toObject()
              });
              
              // Get updated unread count
              const unreadCount = await Notification.countDocuments({
                recipient: mentionedUserId,
                isRead: false
              });
              
              // Emit unread count update
              io.to(`user:${mentionedUserId}`).emit('notification:unread-count', {
                unreadCount
              });
              
              console.log(`✅ Nested reply mention notification sent to user ${mentionedUserId}, unread count: ${unreadCount}`);
            }
          } catch (notificationError) {
            console.error('Failed to create mention notification in nested reply:', notificationError);
          }
        }
      }
    }

    // Emit Socket.IO event
    const io = req.app.get('io');
    if (io) {
      io.emit('reply:replied', {
        postId: post._id,
        commentId: comment._id,
        replyId: reply._id,
        nestedReply: newNestedReply
      });
    }

    res.status(201).json({
      success: true,
      message: 'Nested reply added successfully',
      data: {
        nestedReply: newNestedReply,
        reply: reply
      }
    });
  } catch (error) {
    console.error('Add nested reply error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add nested reply'
    });
  }
});

// @route   GET /api/posts/user/:userId
// @desc    Get posts by specific user
// @access  Private
router.get('/user/:userId', async (req, res) => {
  try {
    // Check if there's a block relationship (if user is authenticated)
    const auth = require('../middleware/auth');
    const token = req.headers.authorization?.split(' ')[1];
    let currentUserId = null;
    
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        currentUserId = decoded.userId;
        
        const Block = require('../models/Block');
        const isBlocked = await Block.isBlocked(decoded.userId, req.params.userId);
        
        if (isBlocked) {
          return res.status(403).json({
            success: false,
            message: 'You cannot view this user\'s posts'
          });
        }
        
        // Check if current user follows the target user (or if viewing own posts)
        const User = require('../models/User');
        const currentUser = await User.findById(currentUserId).select('following');
        
        // Allow viewing own posts or posts from users you follow
        // Convert to strings for comparison to handle ObjectId vs string
        const isOwnPosts = currentUserId.toString() === req.params.userId.toString();
        const isFollowing = currentUser.following.some(id => id.toString() === req.params.userId.toString());
        
        console.log('👤 Current User ID:', currentUserId);
        console.log('👤 Target User ID:', req.params.userId);
        console.log('👤 Is own posts:', isOwnPosts);
        console.log('👤 Is following:', isFollowing);
        
        if (!isOwnPosts && !isFollowing) {
          return res.status(403).json({
            success: false,
            message: 'You can only view posts from users you follow'
          });
        }
      } catch (err) {
        // Token invalid, continue without authentication
        return res.status(401).json({
          success: false,
          message: 'Authentication required to view user posts'
        });
      }
    } else {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to view user posts'
      });
    }

    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const posts = await Post.find({ author: req.params.userId })
      .populate('author', 'name email avatar isPremium premiumFeatures')
      .populate('comments.user', 'name email avatar')
      .populate('comments.taggedUsers', 'name email avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Post.countDocuments({ author: req.params.userId });

    res.status(200).json({
      success: true,
      message: 'User posts retrieved successfully',
      data: {
        posts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get user posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user posts'
    });
  }
});

module.exports = router;
