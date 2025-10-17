const express = require('express');
const { param, query } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const { Achievement, UserAchievement, ACHIEVEMENT_CATEGORIES, PREDEFINED_ACHIEVEMENTS } = require('../models/Achievement');
const achievementService = require('../services/achievementService');

const router = express.Router();

// Apply auth and rate limiting to all routes
router.use(authenticateToken);
router.use(generalLimiter);

// ===== PUBLIC ACHIEVEMENT ROUTES =====

/**
 * GET /achievements
 * Get all available achievements
 */
router.get('/', async (req, res) => {
  try {
    const { category, tier, hideCompleted } = req.query;
    
    const query = { isActive: true };
    
    if (category) {
      query.category = category;
    }
    
    if (tier) {
      query.tier = tier;
    }

    const achievements = await Achievement.find(query).sort({ category: 1, order: 1, tier: 1 });

    // If user wants to hide completed ones, filter them out
    let response = achievements;
    if (hideCompleted === 'true') {
      const userAchievementIds = await UserAchievement.find({
        user: req.user._id,
        isCompleted: true
      }).distinct('achievement');
      
      response = achievements.filter(a => !userAchievementIds.includes(a._id.toString()));
    }

    // Add user progress for each achievement
    const achievementsWithProgress = await Promise.all(
      response.map(async (achievement) => {
        const userAchievement = await UserAchievement.findOne({
          user: req.user._id,
          achievement: achievement._id
        });

        return {
          ...achievement.toObject(),
          userProgress: userAchievement ? {
            progress: userAchievement.progress,
            isCompleted: userAchievement.isCompleted,
            earnedAt: userAchievement.earnedAt,
            completionPercentage: Math.min(100, (userAchievement.progress / achievement.requirement.count * 100).toFixed(1))
          } : {
            progress: 0,
            isCompleted: false,
            earnedAt: null,
            completionPercentage: 0
          }
        };
      })
    );

    res.status(200).json({
      success: true,
      count: achievementsWithProgress.length,
      achievements: achievementsWithProgress
    });
  } catch (error) {
    console.error('Error fetching achievements:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch achievements',
      error: error.message
    });
  }
});

/**
 * GET /achievements/categories
 * Get all achievement categories
 */
router.get('/categories', async (req, res) => {
  try {
    const categories = ACHIEVEMENT_CATEGORIES.map(cat => ({
      key: cat,
      name: cat.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    }));

    res.status(200).json({
      success: true,
      categories
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories',
      error: error.message
    });
  }
});

/**
 * GET /achievements/my
 * Get current user's achievements
 */
router.get('/my', async (req, res) => {
  try {
    const { includeIncomplete, category } = req.query;
    
    const options = {
      includeIncomplete: includeIncomplete === 'true',
      category: category || null
    };

    const userAchievements = await achievementService.getUserAchievements(req.user._id, options);

    res.status(200).json({
      success: true,
      count: userAchievements.length,
      achievements: userAchievements
    });
  } catch (error) {
    console.error('Error fetching user achievements:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user achievements',
      error: error.message
    });
  }
});

/**
 * GET /achievements/my/stats
 * Get current user's achievement statistics
 */
router.get('/my/stats', async (req, res) => {
  try {
    const stats = await achievementService.getUserStats(req.user._id);

    res.status(200).json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error fetching user achievement stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch achievement stats',
      error: error.message
    });
  }
});

/**
 * GET /achievements/user/:userId
 * Get achievements for a specific user (public profile view)
 */
router.get('/user/:userId', [
  param('userId').isMongoId().withMessage('Invalid user ID')
], async (req, res) => {
  try {
    const { userId } = req.params;
    
    const userAchievements = await achievementService.getUserAchievements(userId, {
      includeIncomplete: false // Only show completed achievements on public profile
    });

    const stats = await achievementService.getUserStats(userId);

    res.status(200).json({
      success: true,
      count: userAchievements.length,
      achievements: userAchievements,
      stats
    });
  } catch (error) {
    console.error('Error fetching user achievements:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user achievements',
      error: error.message
    });
  }
});

/**
 * GET /achievements/leaderboard
 * Get achievement leaderboard
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const { limit = 50, category } = req.query;
    
    const leaderboard = await achievementService.getLeaderboard(
      Math.min(parseInt(limit), 100),
      category || null
    );

    // Find current user's rank
    let userRank = null;
    const userIndex = leaderboard.findIndex(entry => entry.userId.toString() === req.user._id.toString());
    if (userIndex !== -1) {
      userRank = userIndex + 1;
    }

    res.status(200).json({
      success: true,
      leaderboard,
      userRank,
      total: leaderboard.length
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard',
      error: error.message
    });
  }
});

/**
 * GET /achievements/:achievementId
 * Get details of a specific achievement
 */
router.get('/:achievementId', [
  param('achievementId').isMongoId().withMessage('Invalid achievement ID')
], async (req, res) => {
  try {
    const { achievementId } = req.params;
    
    const achievement = await Achievement.findById(achievementId);
    
    if (!achievement) {
      return res.status(404).json({
        success: false,
        message: 'Achievement not found'
      });
    }

    // Get user's progress on this achievement
    const userAchievement = await UserAchievement.findOne({
      user: req.user._id,
      achievement: achievementId
    });

    res.status(200).json({
      success: true,
      achievement: {
        ...achievement.toObject(),
        userProgress: userAchievement || {
          progress: 0,
          isCompleted: false,
          earnedAt: null
        }
      }
    });
  } catch (error) {
    console.error('Error fetching achievement details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch achievement details',
      error: error.message
    });
  }
});

// ===== ADMIN ROUTES (for managing achievements) =====

/**
 * POST /achievements/seed
 * Seed predefined achievements (Admin only)
 */
router.post('/seed', async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const results = {
      created: 0,
      updated: 0,
      errors: []
    };

    for (const achievementData of PREDEFINED_ACHIEVEMENTS) {
      try {
        const existing = await Achievement.findOne({ key: achievementData.key });
        
        if (existing) {
          // Update existing
          await Achievement.findByIdAndUpdate(existing._id, achievementData);
          results.updated++;
        } else {
          // Create new
          await Achievement.create(achievementData);
          results.created++;
        }
      } catch (err) {
        results.errors.push({
          key: achievementData.key,
          error: err.message
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Achievements seeded successfully',
      results
    });
  } catch (error) {
    console.error('Error seeding achievements:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to seed achievements',
      error: error.message
    });
  }
});

/**
 * POST /achievements/recalculate
 * Recalculate achievements for current user (useful after system updates)
 */
router.post('/recalculate', async (req, res) => {
  try {
    const actionTypes = [
      'club_join',
      'club_post',
      'club_comment',
      'club_create',
      'club_like_given',
      'club_like_received',
      'moderator_promotion',
      'admin_promotion'
    ];

    const newAchievements = [];

    for (const actionType of actionTypes) {
      const achievements = await achievementService.checkAndAwardAchievements(
        req.user._id,
        actionType,
        {}
      );
      newAchievements.push(...achievements);
    }

    res.status(200).json({
      success: true,
      message: 'Achievements recalculated',
      newAchievements: newAchievements.map(a => ({
        name: a.achievement.name,
        description: a.achievement.description,
        tier: a.achievement.tier,
        points: a.achievement.points
      }))
    });
  } catch (error) {
    console.error('Error recalculating achievements:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to recalculate achievements',
      error: error.message
    });
  }
});

module.exports = router;
