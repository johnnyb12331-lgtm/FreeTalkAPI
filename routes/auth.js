const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation rules
const registerValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces'),
  
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number')
];

const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

// Helper function to generate JWT tokens
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  
  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  return { accessToken, refreshToken };
};

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', registerValidation, async (req, res) => {
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

    const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create new user
    const user = new User({
      name: name.trim(),
      email: email.toLowerCase(),
      password
    });

    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);

    // Save refresh token to user
    user.refreshToken = refreshToken;
    await user.save();

    // Get user stats for complete profile
    const Post = require('../models/Post');
    const postsCount = await Post.countDocuments({ author: user._id });
    const followersCount = user.followers ? user.followers.length : 0;
    const followingCount = user.following ? user.following.length : 0;

    const completeUserProfile = {
      ...user.getPublicProfile(),
      postsCount,
      followersCount,
      followingCount
    };

    // Send response (password is automatically excluded by the schema)
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: completeUserProfile,
        accessToken,
        refreshToken
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register user'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', loginValidation, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Login validation failed:', errors.array());
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;
    console.log('🔐 Login attempt for email:', email);

    // Find user and include password for comparison
    const user = await User.findByEmail(email).select('+password');
    if (!user) {
      console.log('❌ User not found for email:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    console.log('✅ User found:', user.email);

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      console.log('❌ Invalid password for user:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    console.log('✅ Password valid for user:', email);

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);

    // Update user with refresh token and last login
    user.refreshToken = refreshToken;
    user.lastLogin = new Date();
    await user.save();

    // Get user stats for complete profile
    const Post = require('../models/Post');
    const postsCount = await Post.countDocuments({ author: user._id });
    const followersCount = user.followers ? user.followers.length : 0;
    const followingCount = user.following ? user.following.length : 0;

    const completeUserProfile = {
      ...user.getPublicProfile(),
      postsCount,
      followersCount,
      followingCount
    };

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: completeUserProfile,
        accessToken,
        refreshToken
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to login'
    });
  }
});

// @route   POST /api/auth/refresh
// @desc    Refresh access token
// @access  Public
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    
    // Find user with this refresh token
    const user = await User.findById(decoded.userId).select('+refreshToken');
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Generate new tokens
    const tokens = generateTokens(user._id);

    // Update refresh token
    user.refreshToken = tokens.refreshToken;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      }
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to refresh token'
    });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Clear refresh token
    req.user.refreshToken = null;
    await req.user.save();

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to logout'
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user profile with stats
// @access  Private
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const Post = require('../models/Post');
    
    console.log('👤 GET /api/auth/me - Debug info:');
    console.log('   User ID:', req.user._id);
    console.log('   Followers array:', req.user.followers);
    console.log('   Following array:', req.user.following);
    console.log('   Followers length:', req.user.followers ? req.user.followers.length : 'undefined');
    console.log('   Following length:', req.user.following ? req.user.following.length : 'undefined');
    
    // Get user's post count
    const postsCount = await Post.countDocuments({ author: req.user._id });
    console.log('   Posts count:', postsCount);
    
    // Get followers and following counts
    const followersCount = req.user.followers ? req.user.followers.length : 0;
    const followingCount = req.user.following ? req.user.following.length : 0;
    
    const userProfile = req.user.getPublicProfile();
    
    const responseData = {
      user: {
        ...userProfile,
        postsCount,
        followersCount,
        followingCount
      }
    };
    
    console.log('👤 GET /api/auth/me response:');
    console.log('   postsCount:', responseData.user.postsCount);
    console.log('   followersCount:', responseData.user.followersCount);
    console.log('   followingCount:', responseData.user.followingCount);
    
    res.status(200).json({
      success: true,
      message: 'User profile retrieved successfully',
      data: responseData
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile'
    });
  }
});

module.exports = router;