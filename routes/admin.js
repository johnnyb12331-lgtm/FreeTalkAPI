const express = require('express');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const Post = require('../models/Post');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const requireAdmin = require('../middleware/adminAuth');

const router = express.Router();

// @route   GET /api/admin/users
// @desc    Get all users for admin management
// @access  Private (Admin only)
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 100, search = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build search query
    const query = {};
    if (search && search.trim().length > 0) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex }
      ];
    }

    // Get users with pagination
    const users = await User.find(query)
      .select('name email avatar isAdmin isSuspended suspensionReason suspendedAt isBanned bannedAt createdAt')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
});

// @route   GET /api/admin/reports/stats
// @desc    Get report statistics
// @access  Private (Admin only)
router.get('/reports/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await Report.getStats();
    
    // Additional stats
    const recentReports = await Report.getRecent(5);
    
    const reasonStats = await Report.aggregate([
      {
        $group: {
          _id: '$reason',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    const typeStats = await Report.aggregate([
      {
        $group: {
          _id: '$reportType',
          count: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        stats,
        recentReports,
        reasonBreakdown: reasonStats,
        typeBreakdown: typeStats
      }
    });
  } catch (error) {
    console.error('Get report stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
});

// @route   GET /api/admin/reports
// @desc    Get all reports with filtering
// @access  Private (Admin only)
router.get('/reports', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      reportType,
      reason
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter query
    const filter = {};
    if (status) filter.status = status;
    if (reportType) filter.reportType = reportType;
    if (reason) filter.reason = reason;

    // Fetch reports with populated fields
    const reports = await Report.find(filter)
      .populate('reporter', 'name email avatar')
      .populate('reportedUser', 'name email avatar bio')
      .populate({
        path: 'reportedPost',
        select: 'content author images videos createdAt',
        populate: {
          path: 'author',
          select: 'name email avatar'
        }
      })
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    // Get total count for pagination
    const total = await Report.countDocuments(filter);

    // Get statistics
    const stats = await Report.getStats();

    console.log(`📊 Fetched ${reports.length} reports (page ${page})`);

    res.status(200).json({
      success: true,
      data: {
        reports,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        },
        stats
      }
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reports'
    });
  }
});

// @route   GET /api/admin/reports/:id
// @desc    Get single report by ID
// @access  Private (Admin only)
router.get('/reports/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate('reporter', 'name email avatar bio')
      .populate('reportedUser', 'name email avatar bio createdAt')
      .populate({
        path: 'reportedPost',
        select: 'content author images videos createdAt',
        populate: {
          path: 'author',
          select: 'name email avatar'
        }
      })
      .populate('reviewedBy', 'name email');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    res.status(200).json({
      success: true,
      data: { report }
    });
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch report'
    });
  }
});

// @route   PUT /api/admin/reports/:id/review
// @desc    Review a report (mark as resolved, dismissed, etc.)
// @access  Private (Admin only)
router.put('/reports/:id/review', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, adminNotes, actionTaken } = req.body;

    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    let actionSuccessful = false;
    let reportedUserId = null;

    // Handle content removal action
    if (actionTaken === 'content_removed') {
      if (report.reportType === 'post' && report.reportedPost) {
        // Get the post to find its author before deleting
        const postToDelete = await Post.findById(report.reportedPost).select('author');
        if (postToDelete) {
          reportedUserId = postToDelete.author;
          // Delete the reported post
          await Post.findByIdAndDelete(report.reportedPost);
          console.log(`🗑️ Deleted post ${report.reportedPost} due to admin action`);
          actionSuccessful = true;
        } else {
          console.log(`⚠️ Post ${report.reportedPost} not found (may have been already deleted)`);
        }
      } else if (report.reportType === 'user' && report.reportedUser) {
        console.log(`⚠️ Content removal requested for user report - action not applicable`);
      }
    }

    // Handle warning action
    if (actionTaken === 'warning') {
      reportedUserId = report.reportedUser || (report.reportedPost ? (await Post.findById(report.reportedPost).select('author'))?.author : null);
      if (reportedUserId) {
        console.log(`⚠️ Warning issued to user ${reportedUserId}`);
        actionSuccessful = true;
      }
    }

    // Handle user suspension/ban actions
    if (actionTaken === 'user_suspended' || actionTaken === 'user_banned') {
      // Get the reported user ID
      if (report.reportType === 'user') {
        reportedUserId = report.reportedUser;
      } else if (report.reportType === 'post' && report.reportedPost) {
        const post = await Post.findById(report.reportedPost).select('author');
        reportedUserId = post?.author;
      }

      if (reportedUserId) {
        const updateData = {
          isSuspended: true,
          suspensionReason: `Admin action: ${actionTaken.replace('_', ' ')}`,
          suspendedAt: new Date(),
          suspendedBy: req.user._id
        };
        
        if (actionTaken === 'user_banned') {
          updateData.isBanned = true;
          updateData.bannedAt = new Date();
        }
        
        await User.findByIdAndUpdate(reportedUserId, updateData);
        console.log(`🚫 User ${reportedUserId} ${actionTaken === 'user_banned' ? 'banned' : 'suspended'}`);
        actionSuccessful = true;
      } else {
        console.log(`⚠️ Could not find user to ${actionTaken === 'user_banned' ? 'ban' : 'suspend'}`);
      }
    }

    // Update report
    if (status) report.status = status;
    if (adminNotes) report.adminNotes = adminNotes;
    if (actionTaken) report.actionTaken = actionTaken;
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();

    await report.save();

    // Populate for response
    await report.populate('reporter', 'name email');
    await report.populate('reportedUser', 'name email');
    await report.populate('reviewedBy', 'name email');

    // Send notification to the reporter
    try {
      let reporterMessage = '';
      
      if (status === 'resolved') {
        reporterMessage = `Your report has been reviewed and action has been taken. ${actionTaken ? `Action: ${actionTaken.replace(/_/g, ' ')}` : ''}`;
      } else if (status === 'dismissed') {
        reporterMessage = 'Your report has been reviewed. No policy violations were found.';
      } else {
        reporterMessage = 'Your report is being reviewed by our moderation team.';
      }

      await Notification.create({
        recipient: report.reporter,
        sender: req.user._id,
        type: 'report_update',
        message: reporterMessage,
        relatedReport: report._id
      });

      console.log(`📬 Notification sent to reporter: ${report.reporter}`);

      // Emit real-time notification via socket.io
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${report.reporter}`).emit('notification', {
          type: 'report_update',
          message: reporterMessage,
          reportId: report._id,
          status: report.status,
          actionTaken: report.actionTaken,
          createdAt: new Date()
        });
      }
    } catch (notifError) {
      console.error('Error sending notification to reporter:', notifError);
      // Don't fail the request if notification fails
    }

    // Send notification to the reported user (if action was taken)
    if (actionSuccessful && reportedUserId && !reportedUserId.equals(report.reporter)) {
      try {
        let reportedUserMessage = '';
        
        switch (actionTaken) {
          case 'warning':
            reportedUserMessage = 'You have received a warning for violating community guidelines. Please review our policies.';
            break;
          case 'content_removed':
            reportedUserMessage = 'Your content has been removed for violating community guidelines.';
            break;
          case 'user_suspended':
            reportedUserMessage = 'Your account has been temporarily suspended for violating community guidelines. Please contact support for more information.';
            break;
          case 'user_banned':
            reportedUserMessage = 'Your account has been permanently banned for severe violations of community guidelines.';
            break;
          default:
            reportedUserMessage = 'Moderation action has been taken on your account.';
        }

        await Notification.create({
          recipient: reportedUserId,
          sender: req.user._id,
          type: 'report_update',
          message: reportedUserMessage,
          relatedReport: report._id
        });

        console.log(`📬 Notification sent to reported user: ${reportedUserId}`);

        // Emit real-time notification via socket.io
        const io = req.app.get('io');
        if (io) {
          io.to(`user:${reportedUserId}`).emit('notification', {
            type: 'moderation_action',
            message: reportedUserMessage,
            actionTaken: report.actionTaken,
            createdAt: new Date()
          });
        }
      } catch (notifError) {
        console.error('Error sending notification to reported user:', notifError);
        // Don't fail the request if notification fails
      }
    }

    console.log(`✅ Report ${report._id} reviewed by ${req.user.name}`);
    console.log(`   Status: ${report.status}`);
    console.log(`   Action: ${report.actionTaken}`);

    res.status(200).json({
      success: true,
      message: 'Report reviewed successfully',
      data: { report }
    });
  } catch (error) {
    console.error('Review report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to review report'
    });
  }
});

// @route   DELETE /api/admin/reports/:id
// @desc    Delete a report
// @access  Private (Admin only)
router.delete('/reports/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const report = await Report.findByIdAndDelete(req.params.id);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    console.log(`🗑️ Report ${req.params.id} deleted by ${req.user.name}`);

    res.status(200).json({
      success: true,
      message: 'Report deleted successfully'
    });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete report'
    });
  }
});

// @route   POST/PUT /api/admin/users/:userId/suspend
// @desc    Suspend a user account
// @access  Private (Admin only)
const suspendUserHandler = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, duration } = req.body;

    console.log(`⚠️ Admin ${req.user.userId} suspending user ${userId} for ${duration || 'permanent'} days`);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Can't suspend admin users
    if (user.isAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Cannot suspend admin users'
      });
    }

    // Calculate suspension end date
    let suspensionEndDate = null;
    let durationText = 'permanently';
    
    if (duration && duration > 0) {
      suspensionEndDate = new Date();
      suspensionEndDate.setDate(suspensionEndDate.getDate() + duration);
      
      if (duration === 1) {
        durationText = 'for 1 day';
      } else {
        durationText = `for ${duration} days`;
      }
    }

    // Update user suspension status
    user.isSuspended = true;
    user.suspensionReason = reason || 'Account suspended by administrator';
    user.suspendedAt = new Date();
    user.suspendedBy = req.user.userId;
    user.suspensionEndDate = suspensionEndDate;
    user.suspensionDuration = duration || null;
    await user.save();

    // Create notification message
    const notificationMessage = duration 
      ? `Your account has been suspended ${durationText}. Reason: ${user.suspensionReason}`
      : `Your account has been permanently suspended. Reason: ${user.suspensionReason}`;

    // Send notification to user
    try {
      await Notification.create({
        recipient: userId,
        sender: req.user.userId,
        type: 'moderation_action',
        message: notificationMessage
      });

      // Emit real-time notification via socket.io
      const io = req.app.get('io');
      if (io) {
        const roomName = `user:${userId}`;
        io.to(roomName).emit('account_suspended', {
          message: notificationMessage,
          reason: user.suspensionReason,
          duration: duration,
          suspensionEndDate: suspensionEndDate,
          timestamp: new Date()
        });

        io.to(roomName).emit('notification', {
          type: 'moderation_action',
          message: notificationMessage,
          createdAt: new Date()
        });
        
        console.log(`🔔 Suspension notification emitted to user ${userId}`);
      }
    } catch (notifError) {
      console.error('Error sending suspension notification:', notifError);
    }

    console.log(`✅ User ${userId} suspended successfully ${durationText}`);

    res.status(200).json({
      success: true,
      message: 'User suspended successfully',
      data: {
        userId: user._id,
        isSuspended: user.isSuspended,
        suspensionReason: user.suspensionReason,
        suspendedAt: user.suspendedAt,
        suspensionEndDate: suspensionEndDate,
        suspensionDuration: duration
      }
    });
  } catch (error) {
    console.error('Suspend user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to suspend user'
    });
  }
};
router.post('/users/:userId/suspend', authenticateToken, requireAdmin, suspendUserHandler);
router.put('/users/:userId/suspend', authenticateToken, requireAdmin, suspendUserHandler);

// @route   POST/PUT /api/admin/users/:userId/unsuspend
// @desc    Unsuspend a user account
// @access  Private (Admin only)
const unsuspendUserHandler = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.isSuspended) {
      return res.status(400).json({
        success: false,
        message: 'User is not suspended'
      });
    }

    // Unsuspend the user
    user.isSuspended = false;
    user.suspensionReason = null;
    user.suspendedAt = null;
    user.suspendedBy = null;
    await user.save();

    console.log(`✅ User ${userId} unsuspended by admin ${req.user.name}`);

    // Send notification to user
    try {
      await Notification.create({
        recipient: userId,
        sender: req.user._id,
        type: 'moderation_action',
        message: reason || 'Your account suspension has been lifted. You can now access your account normally.'
      });

      // Emit real-time notification
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${userId}`).emit('notification', {
          type: 'moderation_action',
          message: reason || 'Your account suspension has been lifted.',
          createdAt: new Date()
        });
      }
    } catch (notifError) {
      console.error('Error sending unsuspension notification:', notifError);
    }

    res.status(200).json({
      success: true,
      message: 'User unsuspended successfully',
      data: { user: user.getPublicProfile() }
    });
  } catch (error) {
    console.error('Unsuspend user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unsuspend user'
    });
  }
};
router.post('/users/:userId/unsuspend', authenticateToken, requireAdmin, unsuspendUserHandler);
router.put('/users/:userId/unsuspend', authenticateToken, requireAdmin, unsuspendUserHandler);

// @route   POST/PUT /api/admin/users/:userId/ban
// @desc    Ban a user account permanently
// @access  Private (Admin only)
const banUserHandler = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    console.log(`🚫 Admin ${req.user.userId} banning user ${userId}`);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Can't ban admin users
    if (user.isAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Cannot ban admin users'
      });
    }

    // Update user ban status
    user.isBanned = true;
    user.bannedAt = new Date();
    user.isSuspended = true; // Also suspend when banning
    user.suspensionReason = reason || 'Account permanently banned';
    user.suspendedAt = new Date();
    user.suspendedBy = req.user.userId;
    await user.save();

    // Send notification to user
    try {
      const banMessage = `Your account has been permanently banned. Reason: ${user.suspensionReason}`;
      
      await Notification.create({
        recipient: userId,
        sender: req.user.userId,
        type: 'moderation_action',
        message: banMessage
      });

      // Emit real-time notification via socket.io
      const io = req.app.get('io');
      if (io) {
        const roomName = `user:${userId}`;
        io.to(roomName).emit('account_banned', {
          message: banMessage,
          reason: user.suspensionReason,
          timestamp: new Date()
        });

        io.to(roomName).emit('notification', {
          type: 'moderation_action',
          message: banMessage,
          createdAt: new Date()
        });
        
        console.log(`🔔 Ban notification emitted to user ${userId}`);
      }
    } catch (notifError) {
      console.error('Error sending ban notification:', notifError);
    }

    console.log(`✅ User ${userId} banned successfully`);

    res.status(200).json({
      success: true,
      message: 'User banned successfully',
      data: {
        userId: user._id,
        isBanned: user.isBanned,
        bannedAt: user.bannedAt
      }
    });
  } catch (error) {
    console.error('Ban user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to ban user'
    });
  }
};
router.post('/users/:userId/ban', authenticateToken, requireAdmin, banUserHandler);
router.put('/users/:userId/ban', authenticateToken, requireAdmin, banUserHandler);

// @route   POST/PUT /api/admin/users/:userId/unban
// @desc    Unban a user account
// @access  Private (Admin only)
const unbanUserHandler = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.isBanned) {
      return res.status(400).json({
        success: false,
        message: 'User is not banned'
      });
    }

    // Unban the user (also unsuspend)
    user.isBanned = false;
    user.bannedAt = null;
    user.isSuspended = false;
    user.suspensionReason = null;
    user.suspendedAt = null;
    user.suspendedBy = null;
    await user.save();

    console.log(`✅ User ${userId} unbanned by admin ${req.user.name}`);

    // Send notification to user
    try {
      await Notification.create({
        recipient: userId,
        sender: req.user._id,
        type: 'moderation_action',
        message: reason || 'Your account ban has been lifted. You can now access your account normally.'
      });

      // Emit real-time notification
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${userId}`).emit('notification', {
          type: 'moderation_action',
          message: reason || 'Your account ban has been lifted.',
          createdAt: new Date()
        });
      }
    } catch (notifError) {
      console.error('Error sending unban notification:', notifError);
    }

    res.status(200).json({
      success: true,
      message: 'User unbanned successfully',
      data: { user: user.getPublicProfile() }
    });
  } catch (error) {
    console.error('Unban user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unban user'
    });
  }
};
router.post('/users/:userId/unban', authenticateToken, requireAdmin, unbanUserHandler);
router.put('/users/:userId/unban', authenticateToken, requireAdmin, unbanUserHandler);

// @route   GET /api/admin/users/:userId/posts
// @desc    Get all posts by a specific user (admin only, no following restrictions)
// @access  Private (Admin only)
// NOTE: This route MUST come BEFORE /users/:userId to avoid route matching conflicts
router.get('/users/:userId/posts', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Verify user exists
    const user = await User.findById(req.params.userId).select('name email');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get posts by the user
    const posts = await Post.find({ author: req.params.userId })
      .populate('author', 'name email avatar isPremium isVerified')
      .populate({
        path: 'comments.user',
        select: 'name email avatar'
      })
      .populate({
        path: 'originalPost',
        select: 'content author images videos mediaType createdAt',
        populate: {
          path: 'author',
          select: 'name email avatar'
        }
      })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const total = await Post.countDocuments({ author: req.params.userId });

    console.log(`📊 Admin ${req.user.name} viewing posts for user ${user.name} (${user.email})`);

    res.status(200).json({
      success: true,
      message: 'User posts retrieved successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email
        },
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
    console.error('Get user posts (admin) error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user posts'
    });
  }
});

// @route   DELETE /api/admin/users/:userId
// @desc    Delete a user account (Admin action)
// @access  Private (Admin only)
router.delete('/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    console.log(`🗑️ Admin ${req.user.name} deleting user ${userId}`);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Can't delete admin users
    if (user.isAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete admin users'
      });
    }

    // Send notification to user before deletion
    try {
      await Notification.create({
        recipient: userId,
        sender: req.user._id,
        type: 'account_deleted',
        message: reason || 'Your account has been deleted by an administrator. If you believe this was done in error, please contact support.',
      });

      console.log(`📬 Notification created in database for user ${userId}`);

      // Emit real-time notification via socket.io
      const io = req.app.get('io');
      if (io) {
        const roomName = `user:${userId}`;
        const deletionData = {
          message: reason || 'Your account has been deleted by an administrator.',
          timestamp: new Date(),
          reason: reason
        };
        
        console.log(`🔌 Attempting to emit account_deleted to room: ${roomName}`);
        console.log(`📊 Sockets in room:`, io.sockets.adapter.rooms.get(roomName)?.size || 0);
        
        // Emit to user's room
        io.to(roomName).emit('account_deleted', deletionData);
        
        // Also emit a notification event (backup)
        io.to(roomName).emit('notification', {
          type: 'account_deleted',
          title: 'Account Deleted',
          message: deletionData.message,
          createdAt: new Date()
        });
        
        console.log(`✅ Account deletion events emitted to user ${userId}`);
      } else {
        console.log(`⚠️  Socket.io not available - user won't receive real-time notification`);
      }
    } catch (notifError) {
      console.error('❌ Error sending deletion notification:', notifError);
      // Continue with deletion even if notification fails
    }

    // Delete the user
    await User.findByIdAndDelete(userId);

    // Optional: Delete user's related content (posts, messages, etc.)
    // Uncomment these if you want to cascade delete
    // await Post.deleteMany({ author: userId });
    // await Message.deleteMany({ $or: [{ sender: userId }, { receiver: userId }] });
    // await Notification.deleteMany({ $or: [{ recipient: userId }, { sender: userId }] });

    console.log(`✅ User ${userId} deleted successfully by ${req.user.name}`);

    res.status(200).json({
      success: true,
      message: 'User account deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user account'
    });
  }
});

// @route   DELETE /api/admin/posts/:postId
// @desc    Delete a post (admin only)
// @access  Private (Admin only)
router.delete('/posts/:postId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Get post author info for logging
    const author = await User.findById(post.author).select('name email');
    
    await Post.findByIdAndDelete(req.params.postId);

    // Emit socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      // Emit to followers of the post author
      const postAuthor = await User.findById(post.author).select('followers');
      const followerIds = postAuthor?.followers || [];
      
      followerIds.forEach(followerId => {
        io.to(`user:${followerId}`).emit('post:deleted', {
          postId: req.params.postId
        });
      });
      
      console.log(`📡 Emitted post:deleted to ${followerIds.length} followers`);
    }

    console.log(`🗑️ Admin ${req.user.name} deleted post ${req.params.postId} by ${author?.name || 'Unknown'}`);

    res.status(200).json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('Admin delete post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete post'
    });
  }
});

// @route   PATCH /api/admin/users/:userId/status
// @desc    Update user premium and verified status (admin only)
// @access  Private (Admin only)
router.patch('/users/:userId/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { isPremium, isVerified } = req.body;

    // Validate input
    if (isPremium === undefined && isVerified === undefined) {
      return res.status(400).json({
        success: false,
        message: 'At least one status field (isPremium or isVerified) must be provided'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Can't modify admin users
    if (user.isAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Cannot modify admin user status'
      });
    }

    // Prepare update object
    const updateData = {};
    if (isPremium !== undefined) {
      updateData.isPremium = isPremium;
    }
    if (isVerified !== undefined) {
      updateData.isVerified = isVerified;
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true }
    ).select('name email isPremium isVerified');

    console.log(`✨ Admin ${req.user.name} updated user ${updatedUser.name} status:`);
    if (isPremium !== undefined) console.log(`   - Premium: ${isPremium}`);
    if (isVerified !== undefined) console.log(`   - Verified: ${isVerified}`);

    // Send notification to user
    try {
      let notificationMessage = '';
      let notificationTitle = '';
      
      if (isPremium && isVerified) {
        notificationTitle = 'Account Status Updated';
        notificationMessage = '🎉 Congratulations! Your account is now Premium and Verified!';
      } else if (isPremium) {
        notificationTitle = 'Premium Granted';
        notificationMessage = '🎉 Congratulations! Your account is now Premium!';
      } else if (isVerified) {
        notificationTitle = 'Account Verified';
        notificationMessage = '✅ Your account has been verified!';
      } else if (isPremium === false && isVerified === false) {
        notificationTitle = 'Account Status Updated';
        notificationMessage = 'Your Premium and Verified status has been updated.';
      } else if (isPremium === false) {
        notificationTitle = 'Premium Removed';
        notificationMessage = 'Your Premium status has been removed.';
      } else if (isVerified === false) {
        notificationTitle = 'Verification Updated';
        notificationMessage = 'Your Verified status has been updated.';
      }

      if (notificationMessage) {
        const notification = await Notification.create({
          recipient: userId,
          sender: req.user._id,
          type: 'account_update',
          message: notificationMessage,
        });

        console.log(`📬 Status update notification created for user ${userId}`);

        // Emit real-time notification
        const io = req.app.get('io');
        if (io) {
          const roomName = `user:${userId}`;
          
          // Emit profile update so they can refresh their data
          io.to(roomName).emit('profile:updated', {
            userId: userId,
            isPremium: updatedUser.isPremium,
            isVerified: updatedUser.isVerified,
            message: 'Your account status has been updated',
          });
          
          // Also emit notification
          io.to(roomName).emit('notification', {
            _id: notification._id,
            type: 'account_update',
            title: notificationTitle,
            message: notificationMessage,
            createdAt: notification.createdAt,
            read: false,
          });
          
          console.log(`🔌 Emitted profile:updated and notification to room: ${roomName}`);
          console.log(`📊 Sockets in room:`, io.sockets.adapter.rooms.get(roomName)?.size || 0);
        }
      }
    } catch (notifError) {
      console.error('Error sending status update notification:', notifError);
    }

    res.status(200).json({
      success: true,
      message: 'User status updated successfully',
      data: {
        user: updatedUser,
      },
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status'
    });
  }
});

module.exports = router;
