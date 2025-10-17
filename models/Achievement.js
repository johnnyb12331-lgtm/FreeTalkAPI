const mongoose = require('mongoose');

// Achievement categories
const ACHIEVEMENT_CATEGORIES = [
  'club_participation',
  'club_creation',
  'social',
  'content',
  'engagement',
  'special'
];

// Achievement tiers
const ACHIEVEMENT_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

// User achievement schema - tracks individual achievements earned by users
const userAchievementSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  achievement: { type: mongoose.Schema.Types.ObjectId, ref: 'Achievement', required: true },
  earnedAt: { type: Date, default: Date.now },
  progress: { type: Number, default: 0 }, // Current progress towards achievement
  isCompleted: { type: Boolean, default: false },
  clubId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', default: null }, // Club where achievement was earned (if applicable)
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} } // Additional data (e.g., streak count, specific milestones)
}, { timestamps: true });

// Compound index for user-achievement uniqueness
userAchievementSchema.index({ user: 1, achievement: 1 }, { unique: true });
userAchievementSchema.index({ user: 1, isCompleted: 1 });
userAchievementSchema.index({ earnedAt: -1 });

// Achievement definition schema - defines available achievements
const achievementSchema = new mongoose.Schema({
  key: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  }, // Unique identifier (e.g., 'first_club_join', 'club_veteran')
  name: { type: String, required: true },
  description: { type: String, required: true },
  category: { 
    type: String, 
    enum: ACHIEVEMENT_CATEGORIES, 
    required: true,
    index: true 
  },
  tier: { 
    type: String, 
    enum: ACHIEVEMENT_TIERS, 
    default: 'bronze' 
  },
  icon: { type: String, default: null }, // Icon URL or emoji
  color: { type: String, default: '#CD7F32' }, // Hex color for badge display
  points: { type: Number, default: 10 }, // Points awarded for earning this achievement
  requirement: {
    type: { type: String, required: true }, // e.g., 'club_posts', 'club_joins', 'club_comments'
    count: { type: Number, default: 1 }, // How many times the action must be performed
    timeframe: { type: String, default: null }, // e.g., 'daily', 'weekly', 'monthly', 'all_time'
    clubSpecific: { type: Boolean, default: false } // If true, counted per club
  },
  isActive: { type: Boolean, default: true },
  isHidden: { type: Boolean, default: false }, // Hidden achievements (revealed when earned)
  order: { type: Number, default: 0 }, // Display order
  prerequisite: { type: mongoose.Schema.Types.ObjectId, ref: 'Achievement', default: null }, // Must earn this first
  reward: {
    type: { type: String, default: null }, // e.g., 'badge', 'title', 'feature_unlock'
    value: { type: mongoose.Schema.Types.Mixed, default: null } // Reward details
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Indexes
achievementSchema.index({ category: 1, tier: 1, order: 1 });
achievementSchema.index({ isActive: 1, isHidden: 1 });

// Models
const Achievement = mongoose.model('Achievement', achievementSchema);
const UserAchievement = mongoose.model('UserAchievement', userAchievementSchema);

// Predefined achievements for club participation
const PREDEFINED_ACHIEVEMENTS = [
  // CLUB JOINING ACHIEVEMENTS
  {
    key: 'first_club_join',
    name: 'Club Explorer',
    description: 'Join your first club',
    category: 'club_participation',
    tier: 'bronze',
    icon: '🚪',
    color: '#CD7F32',
    points: 10,
    requirement: { type: 'club_joins', count: 1, timeframe: 'all_time', clubSpecific: false }
  },
  {
    key: 'social_butterfly',
    name: 'Social Butterfly',
    description: 'Join 5 different clubs',
    category: 'club_participation',
    tier: 'silver',
    icon: '🦋',
    color: '#C0C0C0',
    points: 25,
    requirement: { type: 'club_joins', count: 5, timeframe: 'all_time', clubSpecific: false }
  },
  {
    key: 'club_enthusiast',
    name: 'Club Enthusiast',
    description: 'Join 10 different clubs',
    category: 'club_participation',
    tier: 'gold',
    icon: '⭐',
    color: '#FFD700',
    points: 50,
    requirement: { type: 'club_joins', count: 10, timeframe: 'all_time', clubSpecific: false }
  },

  // CLUB POSTING ACHIEVEMENTS
  {
    key: 'first_post',
    name: 'First Words',
    description: 'Create your first club post',
    category: 'content',
    tier: 'bronze',
    icon: '📝',
    color: '#CD7F32',
    points: 10,
    requirement: { type: 'club_posts', count: 1, timeframe: 'all_time', clubSpecific: false }
  },
  {
    key: 'active_contributor',
    name: 'Active Contributor',
    description: 'Create 10 club posts',
    category: 'content',
    tier: 'silver',
    icon: '✍️',
    color: '#C0C0C0',
    points: 30,
    requirement: { type: 'club_posts', count: 10, timeframe: 'all_time', clubSpecific: false }
  },
  {
    key: 'content_creator',
    name: 'Content Creator',
    description: 'Create 50 club posts',
    category: 'content',
    tier: 'gold',
    icon: '🎨',
    color: '#FFD700',
    points: 75,
    requirement: { type: 'club_posts', count: 50, timeframe: 'all_time', clubSpecific: false }
  },
  {
    key: 'posting_legend',
    name: 'Posting Legend',
    description: 'Create 100 club posts',
    category: 'content',
    tier: 'platinum',
    icon: '🏆',
    color: '#E5E4E2',
    points: 150,
    requirement: { type: 'club_posts', count: 100, timeframe: 'all_time', clubSpecific: false }
  },

  // CLUB COMMENTING ACHIEVEMENTS
  {
    key: 'conversation_starter',
    name: 'Conversation Starter',
    description: 'Post 10 comments in clubs',
    category: 'engagement',
    tier: 'bronze',
    icon: '💬',
    color: '#CD7F32',
    points: 15,
    requirement: { type: 'club_comments', count: 10, timeframe: 'all_time', clubSpecific: false }
  },
  {
    key: 'discussion_enthusiast',
    name: 'Discussion Enthusiast',
    description: 'Post 50 comments in clubs',
    category: 'engagement',
    tier: 'silver',
    icon: '💭',
    color: '#C0C0C0',
    points: 40,
    requirement: { type: 'club_comments', count: 50, timeframe: 'all_time', clubSpecific: false }
  },
  {
    key: 'community_voice',
    name: 'Community Voice',
    description: 'Post 100 comments in clubs',
    category: 'engagement',
    tier: 'gold',
    icon: '🗣️',
    color: '#FFD700',
    points: 80,
    requirement: { type: 'club_comments', count: 100, timeframe: 'all_time', clubSpecific: false }
  },

  // CLUB CREATION ACHIEVEMENTS
  {
    key: 'club_founder',
    name: 'Club Founder',
    description: 'Create your first club',
    category: 'club_creation',
    tier: 'silver',
    icon: '🏛️',
    color: '#C0C0C0',
    points: 50,
    requirement: { type: 'clubs_created', count: 1, timeframe: 'all_time', clubSpecific: false }
  },
  {
    key: 'community_builder',
    name: 'Community Builder',
    description: 'Create 3 clubs',
    category: 'club_creation',
    tier: 'gold',
    icon: '🏗️',
    color: '#FFD700',
    points: 100,
    requirement: { type: 'clubs_created', count: 3, timeframe: 'all_time', clubSpecific: false }
  },

  // ENGAGEMENT ACHIEVEMENTS (likes/reactions)
  {
    key: 'first_like',
    name: 'Spread the Love',
    description: 'Like your first club post',
    category: 'engagement',
    tier: 'bronze',
    icon: '❤️',
    color: '#CD7F32',
    points: 5,
    requirement: { type: 'club_likes_given', count: 1, timeframe: 'all_time', clubSpecific: false }
  },
  {
    key: 'popular_voice',
    name: 'Popular Voice',
    description: 'Receive 50 likes on your club posts',
    category: 'engagement',
    tier: 'silver',
    icon: '👍',
    color: '#C0C0C0',
    points: 35,
    requirement: { type: 'club_likes_received', count: 50, timeframe: 'all_time', clubSpecific: false }
  },
  {
    key: 'crowd_favorite',
    name: 'Crowd Favorite',
    description: 'Receive 200 likes on your club posts',
    category: 'engagement',
    tier: 'gold',
    icon: '🌟',
    color: '#FFD700',
    points: 100,
    requirement: { type: 'club_likes_received', count: 200, timeframe: 'all_time', clubSpecific: false }
  },

  // CLUB LEADERSHIP ACHIEVEMENTS
  {
    key: 'club_moderator',
    name: 'Club Moderator',
    description: 'Become a moderator in any club',
    category: 'club_participation',
    tier: 'gold',
    icon: '🛡️',
    color: '#FFD700',
    points: 60,
    requirement: { type: 'moderator_roles', count: 1, timeframe: 'all_time', clubSpecific: false }
  },
  {
    key: 'club_admin',
    name: 'Club Admin',
    description: 'Become an admin in any club',
    category: 'club_participation',
    tier: 'platinum',
    icon: '👑',
    color: '#E5E4E2',
    points: 80,
    requirement: { type: 'admin_roles', count: 1, timeframe: 'all_time', clubSpecific: false }
  },

  // STREAK ACHIEVEMENTS
  {
    key: 'daily_visitor',
    name: 'Daily Visitor',
    description: 'Visit clubs for 7 days in a row',
    category: 'club_participation',
    tier: 'silver',
    icon: '📅',
    color: '#C0C0C0',
    points: 40,
    requirement: { type: 'club_visit_streak', count: 7, timeframe: 'daily', clubSpecific: false }
  },
  {
    key: 'dedicated_member',
    name: 'Dedicated Member',
    description: 'Visit clubs for 30 days in a row',
    category: 'club_participation',
    tier: 'gold',
    icon: '🔥',
    color: '#FFD700',
    points: 100,
    requirement: { type: 'club_visit_streak', count: 30, timeframe: 'daily', clubSpecific: false }
  },

  // SPECIAL ACHIEVEMENTS
  {
    key: 'early_bird',
    name: 'Early Bird',
    description: 'Post in a club within the first hour of creation',
    category: 'special',
    tier: 'silver',
    icon: '🐦',
    color: '#C0C0C0',
    points: 30,
    requirement: { type: 'early_club_post', count: 1, timeframe: 'all_time', clubSpecific: false }
  },
  {
    key: 'club_veteran',
    name: 'Club Veteran',
    description: 'Be a member of the same club for 90 days',
    category: 'club_participation',
    tier: 'platinum',
    icon: '🎖️',
    color: '#E5E4E2',
    points: 120,
    requirement: { type: 'club_membership_days', count: 90, timeframe: 'all_time', clubSpecific: true }
  },
  {
    key: 'helpful_hand',
    name: 'Helpful Hand',
    description: 'Help 10 new members in clubs (comment on their first posts)',
    category: 'social',
    tier: 'gold',
    icon: '🤝',
    color: '#FFD700',
    points: 70,
    requirement: { type: 'helped_new_members', count: 10, timeframe: 'all_time', clubSpecific: false }
  }
];

module.exports = {
  Achievement,
  UserAchievement,
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_TIERS,
  PREDEFINED_ACHIEVEMENTS
};
