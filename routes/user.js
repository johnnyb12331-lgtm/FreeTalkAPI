const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const upload = require('../config/multer');
const path = require('path');
const fs = require('fs');
const { 
  profileUpdateLimiter, 
  followLimiter, 
  generalLimiter,
  searchLimiter 
} = require('../middleware/rateLimiter');

const router = express.Router();

// Apply general rate limiting to all user routes
router.use(generalLimiter);

// TEMPORARY: Helper function to check premium features (currently FREE for all)
// TODO: Revert this when premium is enabled
function hasPremiumFeature(user, featureName) {
  // Temporarily making all premium features free for all users
  return true;
  
  // Original logic (uncomment when reverting):
  // return user.isPremium && 
  //        user.premiumFeatures && 
  //        user.premiumFeatures.includes(featureName);
}

// Validation rules
const updateProfileValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces'),
  
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('bio')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Bio cannot exceed 500 characters')
];

// @route   GET /api/user/profile
// @desc    Get user profile
// @access  Private
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        user: req.user.getPublicProfile()
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
});

// @route   GET /api/user/admin-status
// @desc    Check if current user is an admin
// @access  Private
router.get('/admin-status', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('isAdmin');
    
    res.status(200).json({
      success: true,
      data: {
        isAdmin: user?.isAdmin || false
      }
    });
  } catch (error) {
    console.error('Check admin status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check admin status',
      data: {
        isAdmin: false
      }
    });
  }
});

// @route   PUT /api/user/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', authenticateToken, updateProfileValidation, async (req, res) => {
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

    const { name, email, bio } = req.body;
    const updates = {};

    if (name) updates.name = name.trim();
    if (bio !== undefined) updates.bio = bio.trim(); // Allow empty string to clear bio
    if (email) {
      // Check if email is already taken by another user
      const existingUser = await User.findOne({ 
        email: email.toLowerCase(),
        _id: { $ne: req.user._id }
      });
      
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Email is already taken'
        });
      }
      
      updates.email = email.toLowerCase();
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    );

    // Get user stats for complete profile
    const Post = require('../models/Post');
    const postsCount = await Post.countDocuments({ author: updatedUser._id });
    const followersCount = updatedUser.followers ? updatedUser.followers.length : 0;
    const followingCount = updatedUser.following ? updatedUser.following.length : 0;

    const completeUserProfile = {
      ...updatedUser.getPublicProfile(),
      postsCount,
      followersCount,
      followingCount
    };

    // Emit socket event to notify user's own connection about profile update
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${req.user._id}`).emit('user:profile-updated', {
        userId: req.user._id.toString(),
        user: completeUserProfile
      });
      console.log(`👤 Profile updated for user ${req.user._id}, emitting to room: user:${req.user._id}`);
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: completeUserProfile
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// @route   PUT /api/user/profile/avatar
// @desc    Update user profile avatar
// @access  Private
router.put('/profile/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No avatar file provided'
      });
    }

    // Delete old avatar if it exists
    const user = await User.findById(req.user._id);
    if (user.avatar) {
      const oldAvatarPath = path.join(__dirname, '..', user.avatar.replace(/^\//, ''));
      if (fs.existsSync(oldAvatarPath)) {
        fs.unlinkSync(oldAvatarPath);
      }
    }

    // Update user avatar path
    const avatarPath = `/uploads/${req.file.filename}`;
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { avatar: avatarPath },
      { new: true, runValidators: true }
    );

    // Get user stats for complete profile
    const Post = require('../models/Post');
    const postsCount = await Post.countDocuments({ author: updatedUser._id });
    const followersCount = updatedUser.followers ? updatedUser.followers.length : 0;
    const followingCount = updatedUser.following ? updatedUser.following.length : 0;

    const completeUserProfile = {
      ...updatedUser.getPublicProfile(),
      postsCount,
      followersCount,
      followingCount
    };

    // Emit socket event for real-time update
    const io = req.app.get('io');
    const userSockets = req.app.get('userSockets');
    
    if (io && userSockets) {
      // Emit to the user's socket room
      io.to(`user:${req.user._id}`).emit('user:profile-updated', {
        userId: req.user._id,
        avatar: avatarPath,
        user: completeUserProfile
      });
      
      console.log(`📸 Profile avatar updated for user ${req.user._id}, emitting to room: user:${req.user._id}`);
    }

    res.status(200).json({
      success: true,
      message: 'Profile avatar updated successfully',
      data: {
        avatar: avatarPath,
        user: completeUserProfile
      }
    });

  } catch (error) {
    console.error('Update avatar error:', error);
    
    // Clean up uploaded file if there was an error
    if (req.file) {
      const filePath = path.join(__dirname, '..', 'uploads', req.file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update profile avatar'
    });
  }
});

// @route   PUT /api/user/feed-banner
// @desc    Upload feed banner photo
// @access  Private
router.put('/feed-banner', authenticateToken, upload.single('feedBanner'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No banner file provided'
      });
    }

    // Delete old banner if it exists
    const user = await User.findById(req.user._id);
    if (user.feedBannerPhoto) {
      const oldBannerPath = path.join(__dirname, '..', user.feedBannerPhoto.replace(/^\//, ''));
      if (fs.existsSync(oldBannerPath)) {
        fs.unlinkSync(oldBannerPath);
      }
    }

    // Update user feed banner path
    const bannerPath = `/uploads/${req.file.filename}`;
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { feedBannerPhoto: bannerPath },
      { new: true, runValidators: true }
    );

    // Get user stats for complete profile
    const Post = require('../models/Post');
    const postsCount = await Post.countDocuments({ author: updatedUser._id });
    const followersCount = updatedUser.followers ? updatedUser.followers.length : 0;
    const followingCount = updatedUser.following ? updatedUser.following.length : 0;

    const completeUserProfile = {
      ...updatedUser.getPublicProfile(),
      postsCount,
      followersCount,
      followingCount
    };

    // Emit socket event for real-time update
    const io = req.app.get('io');
    const userSockets = req.app.get('userSockets');
    
    if (io && userSockets) {
      // Emit to the user's socket room
      io.to(`user:${req.user._id}`).emit('user:profile-updated', {
        userId: req.user._id,
        feedBannerPhoto: bannerPath,
        user: completeUserProfile
      });
      
      console.log(`🖼️ Feed banner updated for user ${req.user._id}, emitting to room: user:${req.user._id}`);
    }

    res.status(200).json({
      success: true,
      message: 'Feed banner updated successfully',
      data: {
        feedBannerPhoto: bannerPath,
        user: completeUserProfile
      }
    });

  } catch (error) {
    console.error('Update feed banner error:', error);
    
    // Clean up uploaded file if there was an error
    if (req.file) {
      const filePath = path.join(__dirname, '..', 'uploads', req.file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update feed banner'
    });
  }
});

// @route   GET /api/user/suggested
// @desc    Get random suggested users to follow
// @access  Private
router.get('/suggested', authenticateToken, async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    // Get blocked user relationships
    const Block = require('../models/Block');
    const blockedUserIds = await Block.getAllBlockRelationships(req.user._id);

    // Get current user's following list
    const currentUser = await User.findById(req.user._id).select('following');
    const followingIds = currentUser.following || [];

    // Find random users that current user is not following and not blocked
    const suggestedUsers = await User.aggregate([
      {
        $match: {
          _id: { 
            $ne: req.user._id, // Exclude current user
            $nin: [...blockedUserIds, ...followingIds] // Exclude blocked and already following
          }
        }
      },
      { $sample: { size: parseInt(limit) } }, // Get random users
      {
        $project: {
          name: 1,
          email: 1,
          avatar: 1,
          bio: 1,
          followersCount: 1,
          createdAt: 1
        }
      }
    ]);

    res.status(200).json({
      success: true,
      message: 'Suggested users retrieved',
      data: {
        users: suggestedUsers,
        count: suggestedUsers.length
      }
    });

  } catch (error) {
    console.error('Get suggested users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get suggested users'
    });
  }
});

// @route   GET /api/user/top
// @desc    Get top users by follower count
// @access  Private
router.get('/top', authenticateToken, async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    // Get blocked user relationships
    const Block = require('../models/Block');
    const blockedUserIds = await Block.getAllBlockRelationships(req.user._id);

    // Get current user's following list
    const currentUser = await User.findById(req.user._id).select('following');
    const followingIds = currentUser.following || [];

    // Find top users by follower count (exclude blocked and current user)
    const topUsers = await User.aggregate([
      {
        $match: {
          _id: { 
            $ne: req.user._id, // Exclude current user
            $nin: blockedUserIds // Exclude blocked users
          }
        }
      },
      {
        $addFields: {
          followersCount: { $size: { $ifNull: ['$followers', []] } }
        }
      },
      { $sort: { followersCount: -1 } }, // Sort by follower count descending
      { $limit: parseInt(limit) },
      {
        $project: {
          name: 1,
          email: 1,
          avatar: 1,
          bio: 1,
          isVerified: 1,
          followersCount: 1,
          createdAt: 1
        }
      }
    ]);

    // Add isFollowing flag for each user
    const topUsersWithFollowStatus = topUsers.map(user => ({
      ...user,
      isFollowing: followingIds.some(id => id.toString() === user._id.toString())
    }));

    res.status(200).json({
      success: true,
      message: 'Top users retrieved',
      data: {
        users: topUsersWithFollowStatus,
        count: topUsersWithFollowStatus.length
      }
    });

  } catch (error) {
    console.error('Get top users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get top users'
    });
  }
});

// @route   GET /api/user/search
// @desc    Search users by name or email
// @access  Private
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q, query, limit = 10 } = req.query;
    const searchQuery = q || query;

    if (!searchQuery || searchQuery.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters long'
      });
    }

    // Get blocked user relationships
    const Block = require('../models/Block');
    const blockedUserIds = await Block.getAllBlockRelationships(req.user._id);

    const searchRegex = new RegExp(searchQuery.trim(), 'i');
    
    const users = await User.find({
      $and: [
        { _id: { $ne: req.user._id } }, // Exclude current user
        { _id: { $nin: blockedUserIds } }, // Exclude blocked users
        {
          $or: [
            { name: searchRegex },
            { email: searchRegex }
          ]
        }
      ]
    })
    .select('name email avatar isVerified isPremium premiumFeatures createdAt')
    .limit(parseInt(limit))
    .sort({ name: 1 });

    // Get video count for each user
    const Video = require('../models/Video');
    const usersWithVideoCounts = await Promise.all(
      users.map(async (user) => {
        const videoCount = await Video.countDocuments({ 
          author: user._id,
          visibility: 'public'
        });
        
        return {
          _id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          isVerified: user.isVerified || false,
          videoCount,
          createdAt: user.createdAt
        };
      })
    );

    res.status(200).json({
      success: true,
      message: 'Users found',
      data: {
        users: usersWithVideoCounts,
        count: usersWithVideoCounts.length
      }
    });

  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search users'
    });
  }
});

// @route   GET /api/user/followers
// @desc    Get current user's followers list (for group creation)
// @access  Private
router.get('/followers', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100; // Default to 100, allow override
    
    const user = await User.findById(req.user._id)
      .populate({
        path: 'followers',
        select: 'name fullName email avatar bio isOnline lastActive',
        options: { limit }
      })
      .select('followers');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Followers retrieved successfully',
      data: {
        followers: user.followers,
        count: user.followers.length
      }
    });

  } catch (error) {
    console.error('Get followers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get followers'
    });
  }
});

// @route   GET /api/user/mention-search
// @desc    Search followers and following for @mention autocomplete
// @access  Private
router.get('/mention-search', authenticateToken, async (req, res) => {
  try {
    const { q = '', limit = 10 } = req.query;

    // Get current user with followers and following
    const currentUser = await User.findById(req.user._id).select('followers following');
    
    // Combine followers and following (unique users)
    const followerIds = currentUser.followers.map(id => id.toString());
    const followingIds = currentUser.following.map(id => id.toString());
    const allowedUserIds = [...new Set([...followerIds, ...followingIds])];
    
    if (allowedUserIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No connections found',
        data: {
          users: [],
          count: 0
        }
      });
    }

    let users;
    
    // If query is empty, return all connections
    if (!q || q.trim().length === 0) {
      users = await User.find({
        _id: { $in: allowedUserIds }
      })
      .select('name email avatar isPremium premiumFeatures')
      .limit(parseInt(limit))
      .sort({ name: 1 });
    } else {
      // Search with query
      const searchRegex = new RegExp(q.trim(), 'i');
      
      users = await User.find({
        $and: [
          { _id: { $in: allowedUserIds } }, // Only followers and following
          {
            $or: [
              { name: searchRegex },
              { email: searchRegex }
            ]
          }
        ]
      })
      .select('name email avatar isPremium premiumFeatures')
      .limit(parseInt(limit))
      .sort({ name: 1 });
    }

    res.status(200).json({
      success: true,
      message: 'Mentionable users found',
      data: {
        users,
        count: users.length
      }
    });

  } catch (error) {
    console.error('Mention search error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search for mentionable users'
    });
  }
});

// @route   GET /api/users/settings
// @desc    Get user settings
// @access  Private
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('settings');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Settings retrieved successfully',
      data: {
        settings: user.settings || {
          notificationsEnabled: true,
          pushNotificationsEnabled: true,
          emailNotificationsEnabled: false,
          privateAccount: false,
          showOnlineStatus: true,
          theme: 'system'
        }
      }
    });

  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get settings'
    });
  }
});

// @route   PUT /api/users/settings
// @desc    Update user settings
// @access  Private
router.put('/settings', authenticateToken, async (req, res) => {
  try {
    const allowedSettings = [
      'notificationsEnabled',
      'pushNotificationsEnabled',
      'emailNotificationsEnabled',
      'privateAccount',
      'showOnlineStatus',
      'theme'
    ];

    const updates = {};
    for (const key of allowedSettings) {
      if (req.body[key] !== undefined) {
        updates[`settings.${key}`] = req.body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid settings to update'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('settings');

    // Emit socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${req.user._id}`).emit('user:settings-updated', updatedUser.settings);
      console.log(`⚙️ Settings updated for user ${req.user._id}`);
    }

    res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      data: {
        settings: updatedUser.settings
      }
    });

  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings'
    });
  }
});

// @route   PUT /api/users/password
// @desc    Change password
// @access  Private
router.put('/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 4 characters long'
      });
    }

    // Get user with password field
    const user = await User.findById(req.user._id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
});

// @route   GET /api/users/blocked
// @desc    Get list of blocked users
// @access  Private
router.get('/blocked', authenticateToken, async (req, res) => {
  try {
    const Block = require('../models/Block');
    
    const blocks = await Block.find({ blocker: req.user._id })
      .populate('blocked', 'name email avatar bio')
      .sort({ createdAt: -1 });

    const blockedUsers = blocks.map(block => ({
      _id: block.blocked._id,
      name: block.blocked.name,
      email: block.blocked.email,
      avatar: block.blocked.avatar,
      bio: block.blocked.bio,
      blockedAt: block.createdAt
    }));

    res.status(200).json({
      success: true,
      message: 'Blocked users retrieved successfully',
      data: {
        blockedUsers,
        count: blockedUsers.length
      }
    });

  } catch (error) {
    console.error('Get blocked users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get blocked users'
    });
  }
});

// @route   GET /api/users/profile-visitors/stats
// @desc    Get profile visitor statistics (count and recent visitors)
// @access  Private
router.get('/profile-visitors/stats', authenticateToken, async (req, res) => {
  try {
    const ProfileVisitor = require('../models/ProfileVisitor');
    const userId = req.user._id;
    
    // Check if user has premium profile_visitors feature
    const user = await User.findById(userId).select('isPremium premiumFeatures');
    const hasFeature = hasPremiumFeature(user, 'profile_visitors');

    // Calculate date ranges
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get visitor counts for different time periods
    const [totalCount, todayCount, weekCount, monthCount] = await Promise.all([
      // Total unique visitors (all time)
      ProfileVisitor.aggregate([
        { $match: { profileOwnerId: userId } },
        { $group: { _id: '$visitorId' } },
        { $count: 'total' }
      ]),
      // Today's unique visitors
      ProfileVisitor.aggregate([
        { 
          $match: { 
            profileOwnerId: userId,
            visitedAt: { $gte: oneDayAgo }
          } 
        },
        { $group: { _id: '$visitorId' } },
        { $count: 'total' }
      ]),
      // This week's unique visitors
      ProfileVisitor.aggregate([
        { 
          $match: { 
            profileOwnerId: userId,
            visitedAt: { $gte: oneWeekAgo }
          } 
        },
        { $group: { _id: '$visitorId' } },
        { $count: 'total' }
      ]),
      // This month's unique visitors
      ProfileVisitor.aggregate([
        { 
          $match: { 
            profileOwnerId: userId,
            visitedAt: { $gte: oneMonthAgo }
          } 
        },
        { $group: { _id: '$visitorId' } },
        { $count: 'total' }
      ])
    ]);

    const stats = {
      total: totalCount.length > 0 ? totalCount[0].total : 0,
      today: todayCount.length > 0 ? todayCount[0].total : 0,
      thisWeek: weekCount.length > 0 ? weekCount[0].total : 0,
      thisMonth: monthCount.length > 0 ? monthCount[0].total : 0
    };

    let recentVisitors = null;

    // If user has premium feature, return recent visitors list
    if (hasFeature) {
      const visitors = await ProfileVisitor.aggregate([
        {
          $match: {
            profileOwnerId: userId,
            visitedAt: { $gte: oneWeekAgo } // Last 7 days
          }
        },
        {
          $sort: { visitedAt: -1 }
        },
        {
          $group: {
            _id: '$visitorId',
            lastVisit: { $first: '$visitedAt' }
          }
        },
        {
          $sort: { lastVisit: -1 }
        },
        {
          $limit: 10 // Show up to 10 recent visitors
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'visitor'
          }
        },
        {
          $unwind: '$visitor'
        },
        {
          $project: {
            _id: 1,
            lastVisit: 1,
            'visitor._id': 1,
            'visitor.name': 1,
            'visitor.avatar': 1,
            'visitor.bio': 1,
            'visitor.isPremium': 1,
            'visitor.isVerified': 1
          }
        }
      ]);

      recentVisitors = visitors.map(v => ({
        user: v.visitor,
        lastVisit: v.lastVisit
      }));
    }

    res.status(200).json({
      success: true,
      message: 'Profile visitor stats retrieved successfully',
      data: {
        stats,
        recentVisitors,
        hasPremiumAccess: hasFeature
      }
    });

  } catch (error) {
    console.error('Get profile visitor stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile visitor stats'
    });
  }
});

// @route   GET /api/users/profile-visitors
// @desc    Get list of users who visited your profile
// @access  Private
router.get('/profile-visitors', authenticateToken, async (req, res) => {
  try {
    const ProfileVisitor = require('../models/ProfileVisitor');
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Check if user has premium profile_visitors feature
    const user = await User.findById(req.user._id).select('isPremium premiumFeatures');
    const hasFeature = hasPremiumFeature(user, 'profile_visitors');

    if (!hasFeature) {
      return res.status(403).json({
        success: false,
        message: 'This feature requires premium subscription with profile_visitors feature',
        requiresPremium: true
      });
    }

    // Get unique visitors with their most recent visit
    const visitors = await ProfileVisitor.aggregate([
      {
        $match: {
          profileOwnerId: req.user._id
        }
      },
      {
        $sort: { visitedAt: -1 }
      },
      {
        $group: {
          _id: '$visitorId',
          lastVisit: { $first: '$visitedAt' },
          visitCount: { $sum: 1 }
        }
      },
      {
        $sort: { lastVisit: -1 }
      },
      {
        $skip: skip
      },
      {
        $limit: limit
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'visitor'
        }
      },
      {
        $unwind: '$visitor'
      },
      {
        $project: {
          _id: 1,
          lastVisit: 1,
          visitCount: 1,
          'visitor._id': 1,
          'visitor.name': 1,
          'visitor.avatar': 1,
          'visitor.bio': 1,
          'visitor.isPremium': 1,
          'visitor.isVerified': 1
        }
      }
    ]);

    // Get total unique visitors count
    const totalVisitors = await ProfileVisitor.aggregate([
      {
        $match: {
          profileOwnerId: req.user._id
        }
      },
      {
        $group: {
          _id: '$visitorId'
        }
      },
      {
        $count: 'total'
      }
    ]);

    const total = totalVisitors.length > 0 ? totalVisitors[0].total : 0;

    res.status(200).json({
      success: true,
      message: 'Profile visitors retrieved successfully',
      data: {
        visitors: visitors.map(v => ({
          user: v.visitor,
          lastVisit: v.lastVisit,
          visitCount: v.visitCount
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get profile visitors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile visitors'
    });
  }
});

// @route   GET /api/users/saved-posts
// @desc    Get user's saved posts
// @access  Private
router.get('/saved-posts', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get user with populated saved posts
    const Post = require('../models/Post');
    const user = await User.findById(req.user._id)
      .select('savedPosts')
      .populate({
        path: 'savedPosts',
        options: {
          sort: { createdAt: -1 },
          skip: skip,
          limit: limit
        },
        populate: {
          path: 'author',
          select: 'name username avatar email'
        }
      });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Filter out any null posts (in case some were deleted)
    const savedPosts = user.savedPosts.filter(post => post !== null);

    // Get total count of saved posts
    const totalSavedPosts = await User.findById(req.user._id)
      .select('savedPosts')
      .then(u => u.savedPosts.length);

    res.status(200).json({
      success: true,
      message: 'Saved posts retrieved successfully',
      data: {
        posts: savedPosts,
        currentPage: page,
        totalPages: Math.ceil(totalSavedPosts / limit),
        totalPosts: totalSavedPosts,
        hasMore: page * limit < totalSavedPosts
      }
    });
  } catch (error) {
    console.error('Get saved posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve saved posts'
    });
  }
});

// @route   GET /api/users/:userId
// @desc    Get user by ID with stats
// @access  Private
router.get('/:userId', authenticateToken, async (req, res) => {
  try {
    const Post = require('../models/Post');
    const Block = require('../models/Block');
    
    // Check if there's a block relationship
    const isBlocked = await Block.isBlocked(req.user._id, req.params.userId);
    
    if (isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'You cannot view this user\'s profile'
      });
    }
    
    const user = await User.findById(req.params.userId)
      .select('name email avatar bio createdAt followers following isPremium premiumFeatures');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's post count
    const postsCount = await Post.countDocuments({ author: user._id });
    
    // Get user's photo count
    const Photo = require('../models/Photo');
    const photosCount = await Photo.countDocuments({ owner: user._id });
    
    // Get followers and following counts
    const followersCount = user.followers ? user.followers.length : 0;
    const followingCount = user.following ? user.following.length : 0;
    
    // Check if current user is following this user
    const isFollowing = user.followers.includes(req.user._id);

    res.status(200).json({
      success: true,
      message: 'User retrieved successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          bio: user.bio,
          createdAt: user.createdAt,
          postsCount,
          photosCount,
          followersCount,
          followingCount,
          isFollowing,
          isPremium: user.isPremium || false,
          premiumFeatures: user.premiumFeatures || []
        }
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user'
    });
  }
});

// @route   POST /api/users/:userId/follow
// @desc    Follow a user
// @access  Private
router.post('/:userId/follow', authenticateToken, async (req, res) => {
  try {
    const userToFollow = await User.findById(req.params.userId);
    
    if (!userToFollow) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Can't follow yourself
    if (req.params.userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot follow yourself'
      });
    }

    // Check if already following
    if (userToFollow.followers.includes(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: 'You are already following this user'
      });
    }

    // Add to followers/following
    await User.findByIdAndUpdate(req.params.userId, {
      $addToSet: { followers: req.user._id }
    });

    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { following: req.params.userId }
    });

    // Get updated user data with counts
    const updatedFollowedUser = await User.findById(req.params.userId)
      .select('_id name email avatar followers following isPremium premiumFeatures');
    const updatedFollower = await User.findById(req.user._id)
      .select('_id name email avatar followers following isPremium premiumFeatures');

    const followedUserData = {
      userId: updatedFollowedUser._id.toString(),
      followerId: req.user._id.toString(),
      followerName: updatedFollower.name,
      followerAvatar: updatedFollower.avatar,
      followersCount: updatedFollowedUser.followers.length,
      followingCount: updatedFollowedUser.following.length,
      isFollowing: true
    };

    const followerData = {
      userId: updatedFollower._id.toString(),
      followedUserId: updatedFollowedUser._id.toString(),
      followedUserName: updatedFollowedUser.name,
      followedUserAvatar: updatedFollowedUser.avatar,
      followersCount: updatedFollower.followers.length,
      followingCount: updatedFollower.following.length
    };

    // Create notification
    const Notification = require('../models/Notification');
    const notification = await Notification.create({
      recipient: req.params.userId,
      sender: req.user._id,
      type: 'follow'
    });

    // Populate sender details for the socket event
    await notification.populate('sender', 'name email avatar');

    // Emit socket events
    const io = req.app.get('io');
    if (io) {
      // Send notification to the user being followed
      io.to(`user:${req.params.userId}`).emit('notification:new', {
        notification: notification.toJSON()
      });
      
      // Get updated unread count for the followed user
      const unreadCount = await Notification.countDocuments({
        recipient: req.params.userId,
        isRead: false
      });
      
      // Emit unread count update
      io.to(`user:${req.params.userId}`).emit('notification:unread-count', {
        unreadCount
      });
      
      // Emit follow event to the user being followed
      io.to(`user:${req.params.userId}`).emit('user:followed', followedUserData);
      
      // Emit follow event to the follower (current user)
      io.to(`user:${req.user._id}`).emit('user:followed', followerData);
      
      console.log(`👥 Follow notification and events sent to both users`);
      console.log(`   - Followed user: ${req.params.userId}, unread count: ${unreadCount}`);
      console.log(`   - Follower: ${req.user._id}`);
    }

    res.status(200).json({
      success: true,
      message: 'User followed successfully',
      data: {
        isFollowing: true
      }
    });

  } catch (error) {
    console.error('Follow user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to follow user'
    });
  }
});

// @route   POST /api/users/:userId/unfollow
// @desc    Unfollow a user
// @access  Private
router.post('/:userId/unfollow', authenticateToken, async (req, res) => {
  try {
    const userToUnfollow = await User.findById(req.params.userId);
    
    if (!userToUnfollow) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove from followers/following
    await User.findByIdAndUpdate(req.params.userId, {
      $pull: { followers: req.user._id }
    });

    await User.findByIdAndUpdate(req.user._id, {
      $pull: { following: req.params.userId }
    });

    // Get updated user data with counts
    const updatedUnfollowedUser = await User.findById(req.params.userId)
      .select('_id name email avatar followers following isPremium premiumFeatures');
    const updatedUnfollower = await User.findById(req.user._id)
      .select('_id name email avatar followers following isPremium premiumFeatures');

    const unfollowedUserData = {
      userId: updatedUnfollowedUser._id.toString(),
      unfollowerId: req.user._id.toString(),
      unfollowerName: updatedUnfollower.name,
      unfollowerAvatar: updatedUnfollower.avatar,
      followersCount: updatedUnfollowedUser.followers.length,
      followingCount: updatedUnfollowedUser.following.length,
      isFollowing: false
    };

    const unfollowerData = {
      userId: updatedUnfollower._id.toString(),
      unfollowedUserId: updatedUnfollowedUser._id.toString(),
      unfollowedUserName: updatedUnfollowedUser.name,
      unfollowedUserAvatar: updatedUnfollowedUser.avatar,
      followersCount: updatedUnfollower.followers.length,
      followingCount: updatedUnfollower.following.length
    };

    // Emit socket events
    const io = req.app.get('io');
    if (io) {
      // Emit unfollow event to the user being unfollowed
      io.to(`user:${req.params.userId}`).emit('user:unfollowed', unfollowedUserData);
      
      // Emit unfollow event to the unfollower (current user)
      io.to(`user:${req.user._id}`).emit('user:unfollowed', unfollowerData);
      
      console.log(`👥 Unfollow events sent to both users`);
      console.log(`   - Unfollowed user: ${req.params.userId}`);
      console.log(`   - Unfollower: ${req.user._id}`);
    }

    res.status(200).json({
      success: true,
      message: 'User unfollowed successfully',
      data: {
        isFollowing: false
      }
    });

  } catch (error) {
    console.error('Unfollow user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unfollow user'
    });
  }
});

// @route   GET /api/users/:userId/followers
// @desc    Get user's followers list
// @access  Private
router.get('/:userId/followers', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('followers', 'name email avatar bio')
      .select('followers');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Add isFollowing flag for each follower
    const followersWithStatus = user.followers.map(follower => {
      const isFollowing = req.user.following.includes(follower._id);
      return {
        _id: follower._id,
        name: follower.name,
        email: follower.email,
        avatar: follower.avatar,
        bio: follower.bio,
        isFollowing
      };
    });

    res.status(200).json({
      success: true,
      message: 'Followers retrieved successfully',
      data: {
        followers: followersWithStatus,
        count: followersWithStatus.length
      }
    });

  } catch (error) {
    console.error('Get followers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get followers'
    });
  }
});

// @route   GET /api/users/:userId/following
// @desc    Get user's following list
// @access  Private
router.get('/:userId/following', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('following', 'name email avatar bio')
      .select('following');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Add isFollowing flag for each following user
    const followingWithStatus = user.following.map(followedUser => {
      const isFollowing = req.user.following.includes(followedUser._id);
      return {
        _id: followedUser._id,
        name: followedUser.name,
        email: followedUser.email,
        avatar: followedUser.avatar,
        bio: followedUser.bio,
        isFollowing
      };
    });

    res.status(200).json({
      success: true,
      message: 'Following retrieved successfully',
      data: {
        following: followingWithStatus,
        count: followingWithStatus.length
      }
    });

  } catch (error) {
    console.error('Get following error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get following'
    });
  }
});

// @route   POST /api/users/:userId/block
// @desc    Block a user
// @access  Private
router.post('/:userId/block', authenticateToken, async (req, res) => {
  try {
    const Block = require('../models/Block');
    
    const userToBlock = await User.findById(req.params.userId);
    
    if (!userToBlock) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Can't block yourself
    if (req.params.userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot block yourself'
      });
    }

    // Check if already blocked
    const existingBlock = await Block.findOne({
      blocker: req.user._id,
      blocked: req.params.userId
    });

    if (existingBlock) {
      return res.status(400).json({
        success: false,
        message: 'User is already blocked'
      });
    }

    // Create block relationship
    await Block.create({
      blocker: req.user._id,
      blocked: req.params.userId
    });

    // If they were following each other, remove the follow relationships
    await User.findByIdAndUpdate(req.params.userId, {
      $pull: { followers: req.user._id, following: req.user._id }
    });

    await User.findByIdAndUpdate(req.user._id, {
      $pull: { following: req.params.userId, followers: req.params.userId }
    });

    // Emit socket events for real-time update
    const io = req.app.get('io');
    if (io) {
      // Notify the blocker (current user)
      io.to(`user:${req.user._id}`).emit('user:blocked', {
        blockerId: req.user._id.toString(),
        blockedUserId: req.params.userId,
        blockedUserName: userToBlock.name
      });
      
      // Notify the blocked user that they are blocked (so they can't see the blocker's content)
      io.to(`user:${req.params.userId}`).emit('user:blocked', {
        blockerId: req.user._id.toString(),
        blockedUserId: req.params.userId,
        blockedByName: req.user.name
      });
      
      console.log(`🚫 Block events sent to both users`);
      console.log(`   - Blocker: ${req.user._id}`);
      console.log(`   - Blocked user: ${req.params.userId}`);
    }

    res.status(200).json({
      success: true,
      message: 'User blocked successfully',
      data: {
        isBlocked: true
      }
    });

  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to block user'
    });
  }
});

// @route   POST /api/users/:userId/unblock
// @desc    Unblock a user
// @access  Private
router.post('/:userId/unblock', authenticateToken, async (req, res) => {
  try {
    const Block = require('../models/Block');
    
    const userToUnblock = await User.findById(req.params.userId);
    
    if (!userToUnblock) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove block relationship
    const result = await Block.findOneAndDelete({
      blocker: req.user._id,
      blocked: req.params.userId
    });

    if (!result) {
      return res.status(400).json({
        success: false,
        message: 'User is not blocked'
      });
    }

    // Emit socket events for real-time update
    const io = req.app.get('io');
    if (io) {
      // Notify the unblocker (current user)
      io.to(`user:${req.user._id}`).emit('user:unblocked', {
        unblockerId: req.user._id.toString(),
        unblockedUserId: req.params.userId,
        unblockedUserName: userToUnblock.name
      });
      
      // Notify the unblocked user
      io.to(`user:${req.params.userId}`).emit('user:unblocked', {
        unblockerId: req.user._id.toString(),
        unblockedUserId: req.params.userId,
        unblockedByName: req.user.name
      });
      
      console.log(`✅ Unblock events sent to both users`);
      console.log(`   - Unblocker: ${req.user._id}`);
      console.log(`   - Unblocked user: ${req.params.userId}`);
    }

    res.status(200).json({
      success: true,
      message: 'User unblocked successfully',
      data: {
        isBlocked: false
      }
    });

  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unblock user'
    });
  }
});

// @route   DELETE /api/users/account
// @desc    Delete user account
// @access  Private
router.delete('/account', authenticateToken, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user._id);

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account'
    });
  }
});

// @route   POST /api/users/:userId/visit
// @desc    Record a profile visit
// @access  Private
router.post('/:userId/visit', authenticateToken, async (req, res) => {
  try {
    const profileOwnerId = req.params.userId;
    const visitorId = req.user._id.toString();

    // Don't record self-visits
    if (profileOwnerId === visitorId) {
      return res.status(200).json({
        success: true,
        message: 'Self-visit not recorded'
      });
    }

    // Check if profile owner exists
    const profileOwner = await User.findById(profileOwnerId);
    if (!profileOwner) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const ProfileVisitor = require('../models/ProfileVisitor');

    // Record the visit (allows multiple visits from same user)
    const visit = new ProfileVisitor({
      profileOwnerId,
      visitorId
    });
    await visit.save();

    console.log(`👀 Profile visit recorded: ${req.user.name} visited ${profileOwner.name}'s profile`);

    // Get updated visit count for this visitor
    const visitCount = await ProfileVisitor.countDocuments({
      profileOwnerId,
      visitorId
    });

    // Emit real-time update to profile owner
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${profileOwnerId}`).emit('profile:visited', {
        visitor: {
          _id: req.user._id,
          name: req.user.name,
          avatar: req.user.avatar,
          bio: req.user.bio
        },
        lastVisit: visit.visitedAt,
        visitCount: visitCount,
        profileOwnerId: profileOwnerId
      });
      
      console.log(`👀 Real-time visit notification sent to user ${profileOwnerId}`);
      console.log(`   - Visitor: ${req.user.name} (${req.user._id})`);
      console.log(`   - Visit count: ${visitCount}`);
    }

    res.status(201).json({
      success: true,
      message: 'Visit recorded successfully'
    });

  } catch (error) {
    console.error('Record visit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record visit'
    });
  }
});

// @route   POST /api/users/:userId/report
// @desc    Report a user
// @access  Private
router.post('/:userId/report', [
  body('reason')
    .notEmpty()
    .withMessage('Report reason is required')
    .isIn(['spam', 'harassment', 'hate_speech', 'inappropriate_content', 'fake_account', 'impersonation', 'other'])
    .withMessage('Invalid report reason'),
  body('details')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Report details cannot exceed 500 characters')
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const reportedUserId = req.params.userId;

    // Don't allow self-reporting
    if (reportedUserId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot report yourself'
      });
    }

    // Check if reported user exists
    const reportedUser = await User.findById(reportedUserId);
    if (!reportedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const { reason, details } = req.body;

    // Save report to database
    const Report = require('../models/Report');
    const report = new Report({
      reportType: 'user',
      reportedUser: reportedUserId,
      reporter: req.user._id,
      reason,
      details: details || '',
      status: 'pending'
    });
    await report.save();

    console.log(`🚨 User report saved to database`);
    console.log(`   Report ID: ${report._id}`);
    console.log(`   Reporter: ${req.user.name} (${req.user.email})`);
    console.log(`   Reported User: ${reportedUser.name} (${reportedUser.email})`);
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
    console.error('Report user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit report'
    });
  }
});

// @route   POST /api/user/get-verified
// @desc    Instant verification - Free for all users (NO premium required!)
// @access  Private
router.post('/get-verified', authenticateToken, async (req, res) => {
  try {
    console.log('🎉 Instant verification request from user:', req.user._id);

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already verified
    if (user.isVerified) {
      return res.status(200).json({
        success: true,
        message: 'Already verified',
        data: {
          isVerified: true,
          verifiedAt: user.verifiedAt || new Date(),
          verificationMethod: user.verificationMethod
        }
      });
    }

    // Grant instant verification (FREE - does NOT grant premium!)
    user.isVerified = true;
    user.verifiedAt = new Date();
    user.verificationMethod = 'free';

    await user.save();

    console.log('✅ User verified successfully (free verification):', user._id);

    res.status(200).json({
      success: true,
      message: 'Congratulations! You are now verified! 🎉\n\nVerified users get:\n✅ Blue verification badge\n✅ Higher trust in search results\n✅ Priority in recommendations\n✅ Access to verified-only spaces\n\nUpgrade to Premium for exclusive features!',
      data: {
        isVerified: true,
        isPremium: user.isPremium,
        verifiedAt: user.verifiedAt,
        verificationMethod: user.verificationMethod
      }
    });

  } catch (error) {
    console.error('Instant verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify account',
      error: error.message
    });
  }
});

// @desc    Get verified-only feed (only verified users shown)
// @access  Private (requires verification)
router.get('/verified-feed', authenticateToken, async (req, res) => {
  try {
    const requestingUser = await User.findById(req.user._id);
    
    if (!requestingUser.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'This feature is only available to verified users. Get verified for free!',
        requiresVerification: true
      });
    }

    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // Get only verified users
    const verifiedUsers = await User.find({ 
      isVerified: true,
      _id: { $ne: req.user._id }
    })
      .select('name email avatar bio isVerified isPremium premiumFeatures verifiedAt followers following')
      .sort({ verifiedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await User.countDocuments({ isVerified: true, _id: { $ne: req.user._id } });

    res.json({
      success: true,
      data: {
        users: verifiedUsers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching verified feed:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching verified users',
      error: error.message
    });
  }
});

// @desc    Get user's verification status and benefits
// @access  Private
router.get('/verification-status', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const verifiedBenefits = [
      '✅ Blue verification badge',
      '✅ Higher trust score',
      '✅ Priority in search results',
      '✅ Access to verified-only feed',
      '✅ Increased visibility',
      '✅ Less likely to be flagged as spam'
    ];

    const premiumBenefits = [
      '💎 Gold premium badge',
      '💎 See who viewed your profile',
      '💎 No advertisements',
      '💎 Custom themes & colors',
      '💎 Unlimited storage',
      '💎 Advanced analytics',
      '💎 Priority support',
      '💎 Early access to features',
      '💎 Download videos',
      '💎 Control read receipts',
      '💎 Ghost mode (browse invisibly)'
    ];

    res.json({
      success: true,
      data: {
        isVerified: user.isVerified,
        verifiedAt: user.verifiedAt,
        verificationMethod: user.verificationMethod,
        isPremium: user.isPremium,
        premiumTier: user.premiumTier,
        premiumFeatures: user.premiumFeatures,
        premiumExpiresAt: user.premiumExpiresAt,
        verifiedBenefits,
        premiumBenefits
      }
    });

  } catch (error) {
    console.error('Error getting verification status:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting status',
      error: error.message
    });
  }
});

module.exports = router;