const rateLimit = require('express-rate-limit');

/**
 * Centralized Rate Limiting Configuration
 * Protects API endpoints from abuse while allowing normal usage
 */

// Strict rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count successful requests too
  // Trust the first proxy (nginx) - use X-Forwarded-For header for real IP
  skip: (req) => !req.ip, // Skip if no IP available
});

// Moderate rate limiting for content creation (posts, comments, messages)
const createContentLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 posts/comments per minute
  message: {
    success: false,
    message: 'You are creating content too quickly. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.ip,
});

// Light rate limiting for general API requests
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    success: false,
    message: 'Too many requests. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.ip,
});

// Very strict rate limiting for expensive operations (uploads, reports)
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 operations per 15 minutes
  message: {
    success: false,
    message: 'You have exceeded the rate limit for this operation. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.ip,
});

// Moderate rate limiting for messaging
const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 messages per minute
  message: {
    success: false,
    message: 'You are sending messages too quickly. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.ip,
});

// Rate limiting for search operations
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 searches per minute
  message: {
    success: false,
    message: 'Too many search requests. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.ip,
});

// Rate limiting for reaction operations (likes, etc.)
const reactionLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 reactions per minute
  message: {
    success: false,
    message: 'You are reacting too quickly. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.ip,
});

// Rate limiting for follow/unfollow operations
const followLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 follow actions per minute
  message: {
    success: false,
    message: 'You are performing too many follow/unfollow actions. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.ip,
});

// Rate limiting for profile updates
const profileUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 updates per 15 minutes
  message: {
    success: false,
    message: 'You are updating your profile too frequently. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.ip,
});

// Rate limiting for password reset requests
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 reset attempts per hour
  message: {
    success: false,
    message: 'Too many password reset requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.ip,
});

module.exports = {
  authLimiter,
  createContentLimiter,
  generalLimiter,
  strictLimiter,
  messageLimiter,
  searchLimiter,
  reactionLimiter,
  followLimiter,
  profileUpdateLimiter,
  passwordResetLimiter,
};
