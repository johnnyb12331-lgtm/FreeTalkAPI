const { Achievement, UserAchievement } = require('../models/Achievement');
const User = require('../models/User');
const Club = require('../models/Club');
const Notification = require('../models/Notification');

/**
 * Achievement Service
 * Handles checking and awarding achievements to users based on their club activities
 */
class AchievementService {
  
  /**
   * Check and award achievements for a user based on a specific action
   * @param {String} userId - User ID
   * @param {String} actionType - Type of action (e.g., 'club_join', 'club_post', 'club_comment')
   * @param {Object} metadata - Additional metadata about the action
   * @returns {Array} - Array of newly earned achievements
   */
  async checkAndAwardAchievements(userId, actionType, metadata = {}) {
    try {
      const newAchievements = [];
      
      // Get all active achievements for this action type
      const relevantAchievements = await Achievement.find({
        isActive: true,
        'requirement.type': this.mapActionToRequirementType(actionType)
      });

      for (const achievement of relevantAchievements) {
        // Check if user already has this achievement
        const existingUserAchievement = await UserAchievement.findOne({
          user: userId,
          achievement: achievement._id
        });

        // If already completed, skip
        if (existingUserAchievement && existingUserAchievement.isCompleted) {
          continue;
        }

        // Check prerequisites
        if (achievement.prerequisite) {
          const hasPrerequisite = await UserAchievement.findOne({
            user: userId,
            achievement: achievement.prerequisite,
            isCompleted: true
          });
          
          if (!hasPrerequisite) {
            continue;
          }
        }

        // Calculate progress
        const progress = await this.calculateProgress(userId, achievement, metadata);

        // Check if achievement is completed
        if (progress >= achievement.requirement.count) {
          const userAchievement = existingUserAchievement || new UserAchievement({
            user: userId,
            achievement: achievement._id,
            clubId: metadata.clubId || null
          });

          userAchievement.progress = progress;
          userAchievement.isCompleted = true;
          userAchievement.earnedAt = new Date();
          userAchievement.metadata = metadata;

          await userAchievement.save();

          // Add points to user (if you have a points system)
          await this.awardPoints(userId, achievement.points);

          // Create notification
          await this.createAchievementNotification(userId, achievement);

          newAchievements.push({
            achievement,
            userAchievement
          });
        } else if (!existingUserAchievement || existingUserAchievement.progress < progress) {
          // Update progress if changed
          const userAchievement = existingUserAchievement || new UserAchievement({
            user: userId,
            achievement: achievement._id,
            clubId: metadata.clubId || null
          });

          userAchievement.progress = progress;
          userAchievement.metadata = metadata;
          await userAchievement.save();
        }
      }

      return newAchievements;
    } catch (error) {
      console.error('Error checking achievements:', error);
      throw error;
    }
  }

  /**
   * Map action type to achievement requirement type
   */
  mapActionToRequirementType(actionType) {
    const mapping = {
      'club_join': 'club_joins',
      'club_post': 'club_posts',
      'club_comment': 'club_comments',
      'club_create': 'clubs_created',
      'club_like_given': 'club_likes_given',
      'club_like_received': 'club_likes_received',
      'moderator_promotion': 'moderator_roles',
      'admin_promotion': 'admin_roles',
      'club_visit': 'club_visit_streak',
      'early_post': 'early_club_post',
      'help_new_member': 'helped_new_members',
      'membership_duration': 'club_membership_days'
    };
    
    return mapping[actionType] || actionType;
  }

  /**
   * Calculate user progress for a specific achievement
   */
  async calculateProgress(userId, achievement, metadata = {}) {
    const { type, clubSpecific, timeframe } = achievement.requirement;
    
    try {
      let count = 0;

      switch (type) {
        case 'club_joins':
          count = await this.countClubJoins(userId, timeframe);
          break;
        
        case 'club_posts':
          count = await this.countClubPosts(userId, clubSpecific ? metadata.clubId : null, timeframe);
          break;
        
        case 'club_comments':
          count = await this.countClubComments(userId, clubSpecific ? metadata.clubId : null, timeframe);
          break;
        
        case 'clubs_created':
          count = await this.countClubsCreated(userId, timeframe);
          break;
        
        case 'club_likes_given':
          count = await this.countClubLikesGiven(userId, timeframe);
          break;
        
        case 'club_likes_received':
          count = await this.countClubLikesReceived(userId, timeframe);
          break;
        
        case 'moderator_roles':
        case 'admin_roles':
          count = await this.countLeadershipRoles(userId, type);
          break;
        
        case 'club_visit_streak':
          count = await this.calculateVisitStreak(userId);
          break;
        
        case 'club_membership_days':
          count = await this.calculateMembershipDays(userId, metadata.clubId);
          break;
        
        case 'early_club_post':
          count = metadata.isEarlyPost ? 1 : 0;
          break;
        
        case 'helped_new_members':
          count = await this.countHelpedNewMembers(userId);
          break;
        
        default:
          count = 0;
      }

      return count;
    } catch (error) {
      console.error('Error calculating progress:', error);
      return 0;
    }
  }

  /**
   * Helper methods to count various activities
   */
  
  async countClubJoins(userId, timeframe) {
    const clubs = await Club.find({ 'members.user': userId });
    return clubs.length;
  }

  async countClubPosts(userId, clubId, timeframe) {
    const query = clubId 
      ? { _id: clubId, 'discussions.author': userId, 'discussions.isDeleted': false }
      : { 'discussions.author': userId, 'discussions.isDeleted': false };
    
    const clubs = await Club.find(query);
    
    let count = 0;
    clubs.forEach(club => {
      count += club.discussions.filter(d => 
        d.author.toString() === userId.toString() && !d.isDeleted
      ).length;
    });
    
    return count;
  }

  async countClubComments(userId, clubId, timeframe) {
    const query = clubId 
      ? { _id: clubId, 'comments.author': userId, 'comments.isDeleted': false }
      : { 'comments.author': userId, 'comments.isDeleted': false };
    
    const clubs = await Club.find(query);
    
    let count = 0;
    clubs.forEach(club => {
      count += club.comments.filter(c => 
        c.author.toString() === userId.toString() && !c.isDeleted
      ).length;
    });
    
    return count;
  }

  async countClubsCreated(userId, timeframe) {
    const count = await Club.countDocuments({ owner: userId });
    return count;
  }

  async countClubLikesGiven(userId, timeframe) {
    // Count all likes given by user on club posts
    const clubs = await Club.find({ 'discussions.likes': userId });
    
    let count = 0;
    clubs.forEach(club => {
      club.discussions.forEach(discussion => {
        if (discussion.likes.includes(userId)) {
          count++;
        }
      });
    });
    
    return count;
  }

  async countClubLikesReceived(userId, timeframe) {
    // Count all likes received on user's club posts
    const clubs = await Club.find({ 'discussions.author': userId });
    
    let count = 0;
    clubs.forEach(club => {
      club.discussions.forEach(discussion => {
        if (discussion.author.toString() === userId.toString()) {
          count += discussion.likesCount || discussion.likes.length;
        }
      });
    });
    
    return count;
  }

  async countLeadershipRoles(userId, roleType) {
    const role = roleType === 'moderator_roles' ? 'moderator' : 'admin';
    const clubs = await Club.find({
      'members': {
        $elemMatch: {
          user: userId,
          role: { $in: role === 'moderator' ? ['moderator', 'admin', 'owner'] : ['admin', 'owner'] }
        }
      }
    });
    
    return clubs.length;
  }

  async calculateVisitStreak(userId) {
    // This would require a separate tracking mechanism
    // For now, return a placeholder
    // You would need to implement daily visit tracking
    return 0;
  }

  async calculateMembershipDays(userId, clubId) {
    if (!clubId) return 0;
    
    const club = await Club.findById(clubId);
    if (!club) return 0;
    
    const member = club.members.find(m => m.user.toString() === userId.toString());
    if (!member) return 0;
    
    const daysSinceJoined = Math.floor((Date.now() - member.joinedAt.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceJoined;
  }

  async countHelpedNewMembers(userId) {
    // This would require tracking first-time posters and who commented
    // For now, return a placeholder
    return 0;
  }

  /**
   * Award points to user
   */
  async awardPoints(userId, points) {
    // If you have a points system in User model, update it here
    // For now, we'll add it to a new field if needed
    try {
      await User.findByIdAndUpdate(userId, {
        $inc: { 'achievementPoints': points }
      });
    } catch (error) {
      console.error('Error awarding points:', error);
    }
  }

  /**
   * Create notification for new achievement
   */
  async createAchievementNotification(userId, achievement) {
    try {
      await Notification.create({
        user: userId,
        type: 'achievement_earned',
        title: 'Achievement Unlocked! 🎉',
        message: `You earned the "${achievement.name}" badge! ${achievement.description}`,
        data: {
          achievementId: achievement._id,
          achievementKey: achievement.key,
          achievementName: achievement.name,
          achievementIcon: achievement.icon,
          achievementTier: achievement.tier,
          points: achievement.points
        }
      });
    } catch (error) {
      console.error('Error creating achievement notification:', error);
    }
  }

  /**
   * Get all achievements for a user
   */
  async getUserAchievements(userId, options = {}) {
    const { includeIncomplete = false, category = null } = options;
    
    const query = { user: userId };
    if (!includeIncomplete) {
      query.isCompleted = true;
    }

    const userAchievements = await UserAchievement.find(query)
      .populate('achievement')
      .sort({ earnedAt: -1 });

    if (category) {
      return userAchievements.filter(ua => ua.achievement.category === category);
    }

    return userAchievements;
  }

  /**
   * Get achievement leaderboard
   */
  async getLeaderboard(limit = 50, category = null) {
    const matchStage = { isCompleted: true };
    
    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'achievements',
          localField: 'achievement',
          foreignField: '_id',
          as: 'achievementData'
        }
      },
      { $unwind: '$achievementData' }
    ];

    if (category) {
      pipeline.push({ $match: { 'achievementData.category': category } });
    }

    pipeline.push(
      {
        $group: {
          _id: '$user',
          totalPoints: { $sum: '$achievementData.points' },
          achievementCount: { $sum: 1 },
          achievements: { $push: '$achievementData' }
        }
      },
      { $sort: { totalPoints: -1, achievementCount: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userData'
        }
      },
      { $unwind: '$userData' },
      {
        $project: {
          userId: '$_id',
          user: {
            _id: '$userData._id',
            name: '$userData.name',
            avatar: '$userData.avatar',
            isVerified: '$userData.isVerified'
          },
          totalPoints: 1,
          achievementCount: 1,
          recentAchievements: { $slice: ['$achievements', 5] }
        }
      }
    );

    return await UserAchievement.aggregate(pipeline);
  }

  /**
   * Get user's achievement stats
   */
  async getUserStats(userId) {
    const completed = await UserAchievement.countDocuments({
      user: userId,
      isCompleted: true
    });

    const inProgress = await UserAchievement.countDocuments({
      user: userId,
      isCompleted: false
    });

    const totalAchievements = await Achievement.countDocuments({ isActive: true });

    const userAchievements = await UserAchievement.find({
      user: userId,
      isCompleted: true
    }).populate('achievement');

    const totalPoints = userAchievements.reduce((sum, ua) => sum + (ua.achievement.points || 0), 0);

    // Count by category
    const byCategory = {};
    userAchievements.forEach(ua => {
      const cat = ua.achievement.category;
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    // Count by tier
    const byTier = {};
    userAchievements.forEach(ua => {
      const tier = ua.achievement.tier;
      byTier[tier] = (byTier[tier] || 0) + 1;
    });

    return {
      completed,
      inProgress,
      totalAchievements,
      totalPoints,
      completionRate: totalAchievements > 0 ? (completed / totalAchievements * 100).toFixed(1) : 0,
      byCategory,
      byTier,
      recentAchievements: userAchievements.slice(0, 5)
    };
  }
}

module.exports = new AchievementService();
