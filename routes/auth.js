const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { authLimiter, passwordResetLimiter } = require('../middleware/rateLimiter');
const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');
const axios = require('axios');
const { sendPasswordResetEmail, sendPasswordResetConfirmation } = require('../services/emailService');

const router = express.Router();

// Initialize Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
      // Format validation errors into user-friendly messages
      const errorMessages = errors.array().map(err => err.msg);
      const detailedMessage = errorMessages.join('. ');
      
      return res.status(400).json({
        success: false,
        message: detailedMessage,
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

// @route   POST /api/auth/google
// @desc    Sign in with Google
// @access  Public
router.post('/google', async (req, res) => {
  try {
    const { idToken, accessToken: googleAccessToken } = req.body;

    // We need either an ID token or access token
    if (!idToken && !googleAccessToken) {
      return res.status(400).json({
        success: false,
        message: 'Either ID token or access token is required'
      });
    }

    let payload;

    // Try ID token first (preferred method)
    if (idToken) {
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: idToken,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload();
        console.log('✅ Verified using ID token');
      } catch (error) {
        console.error('❌ ID token verification failed:', error);
        // Fall back to access token if ID token fails
        if (!googleAccessToken) {
          return res.status(401).json({
            success: false,
            message: 'Invalid Google ID token'
          });
        }
      }
    }

    // If no payload yet, try access token
    if (!payload && googleAccessToken) {
      try {
        // Verify access token by fetching user info from Google
        const response = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${googleAccessToken}`);
        if (!response.ok) {
          throw new Error('Failed to verify access token');
        }
        payload = await response.json();
        console.log('✅ Verified using access token');
      } catch (error) {
        console.error('❌ Access token verification failed:', error);
        return res.status(401).json({
          success: false,
          message: 'Invalid Google access token'
        });
      }
    }

    if (!payload) {
      return res.status(401).json({
        success: false,
        message: 'Unable to verify Google authentication'
      });
    }
    const googleId = payload['sub'];
    const email = payload['email'];
    const name = payload['name'];
    const picture = payload['picture'];
    const emailVerified = payload['email_verified'];

    console.log('✅ Google token verified:', { googleId, email, name });

    // Check if user already exists with this Google ID
    let user = await User.findOne({ googleId });

    if (!user) {
      // Check if email already exists (user might have registered normally)
      if (email) {
        user = await User.findByEmail(email);
        if (user) {
          // Link Google ID to existing account
          user.googleId = googleId;
          if (picture && !user.avatar) {
            user.avatar = picture;
          }
          await user.save();
          console.log('✅ Linked Google ID to existing account:', user.email);
        }
      }

      // Create new user if still doesn't exist
      if (!user) {
        const userData = {
          name: name || 'Google User',
          email: email,
          googleId: googleId,
          password: Math.random().toString(36).slice(-16), // Random password (won't be used)
          emailVerified: emailVerified || false,
          avatar: picture || null,
        };

        user = new User(userData);
        await user.save();
        console.log('✅ Created new user via Google Sign In:', user.email);
      }
    } else {
      console.log('✅ Existing Google user logged in:', user.email);
      // Update avatar if changed
      if (picture && user.avatar !== picture) {
        user.avatar = picture;
        await user.save();
      }
    }

    // Generate JWT tokens
    const { accessToken, refreshToken } = generateTokens(user._id.toString());

    // Save refresh token
    user.refreshToken = refreshToken;
    await user.save();

    // Return user data
    res.status(200).json({
      success: true,
      message: 'Google Sign In successful',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          profileImage: user.avatar,
          isVerified: user.isVerified,
          createdAt: user.createdAt
        },
        tokens: {
          accessToken,
          refreshToken
        }
      }
    });

  } catch (error) {
    console.error('❌ Google Sign In error:', error);
    res.status(500).json({
      success: false,
      message: 'Google Sign In failed. Please try again.'
    });
  }
});

// @route   POST /api/auth/facebook
// @desc    Sign in with Facebook
// @access  Public
router.post('/facebook', [
  body('accessToken')
    .notEmpty()
    .withMessage('Access token is required'),
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

    const { accessToken } = req.body;

    // Verify the Facebook access token by calling Facebook's Graph API
    let fbResponse;
    try {
      fbResponse = await axios.get(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${accessToken}`);
    } catch (error) {
      console.error('❌ Facebook token verification failed:', error.response?.data || error.message);
      return res.status(401).json({
        success: false,
        message: 'Invalid Facebook access token'
      });
    }

    const { id: facebookId, name, email, picture } = fbResponse.data;
    const profilePicture = picture?.data?.url;

    console.log('✅ Facebook token verified:', { facebookId, email, name });

    if (!facebookId) {
      return res.status(400).json({
        success: false,
        message: 'Could not retrieve Facebook user ID'
      });
    }

    // Check if user already exists with this Facebook ID
    let user = await User.findOne({ facebookId });

    if (!user) {
      // Check if email already exists (user might have registered normally)
      if (email) {
        user = await User.findByEmail(email);
        if (user) {
          // Link Facebook ID to existing account
          user.facebookId = facebookId;
          if (profilePicture && !user.avatar) {
            user.avatar = profilePicture;
          }
          await user.save();
          console.log('✅ Linked Facebook ID to existing account:', user.email);
        }
      }

      // Create new user if still doesn't exist
      if (!user) {
        const userData = {
          name: name || 'Facebook User',
          email: email || `${facebookId}@facebook.private`, // Fallback if no email
          facebookId: facebookId,
          password: Math.random().toString(36).slice(-16), // Random password (won't be used)
          emailVerified: !!email, // Verified if email provided by Facebook
          avatar: profilePicture || null,
        };

        user = new User(userData);
        await user.save();
        console.log('✅ Created new user via Facebook Sign In:', user.email);
      }
    } else {
      console.log('✅ Existing Facebook user logged in:', user.email);
      // Update avatar if changed
      if (profilePicture && user.avatar !== profilePicture) {
        user.avatar = profilePicture;
        await user.save();
      }
    }

    // Generate JWT tokens
    const { accessToken: jwtAccessToken, refreshToken } = generateTokens(user._id.toString());

    // Save refresh token
    user.refreshToken = refreshToken;
    await user.save();

    // Return user data
    res.status(200).json({
      success: true,
      message: 'Facebook Sign In successful',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          profileImage: user.avatar,
          isVerified: user.isVerified,
          createdAt: user.createdAt
        },
        tokens: {
          accessToken: jwtAccessToken,
          refreshToken
        }
      }
    });

  } catch (error) {
    console.error('❌ Facebook Sign In error:', error);
    res.status(500).json({
      success: false,
      message: 'Facebook Sign In failed. Please try again.'
    });
  }
});

// @route   POST /api/auth/apple
// @desc    Sign in with Apple (REQUIRED by App Store)
// @access  Public
router.post('/apple', [
  body('identityToken')
    .notEmpty()
    .withMessage('Identity token is required'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email format'),
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

    const { identityToken, email, name } = req.body;

    console.log('🍎 Apple Sign In attempt:', { email, name });

    // Verify the Apple identity token using apple-signin-auth
    let appleResponse;
    try {
      appleResponse = await appleSignin.verifyIdToken(identityToken, {
        // REQUIRED: Add these to your .env file
        // Get from: https://developer.apple.com/account/resources/identifiers/list/serviceId
        audience: process.env.APPLE_CLIENT_ID || 'com.freetalk.social', // Your app's bundle ID
        ignoreExpiration: false, // Enforce token expiration
      });
    } catch (error) {
      console.error('❌ Apple token verification failed:', error);
      return res.status(401).json({
        success: false,
        message: 'Invalid Apple identity token'
      });
    }

    const appleUserId = appleResponse.sub; // Apple user ID
    const appleEmail = appleResponse.email || email; // Use verified email from token

    console.log('✅ Apple token verified:', { appleUserId, appleEmail });

    if (!appleUserId) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract user ID from token'
      });
    }

    // Check if user already exists with this Apple ID
    let user = await User.findOne({ appleId: appleUserId });

    if (!user) {
      // Check if email already exists (user might have registered normally)
      if (appleEmail) {
        user = await User.findByEmail(appleEmail);
        if (user) {
          // Link Apple ID to existing account
          user.appleId = appleUserId;
          await user.save();
          console.log('✅ Linked Apple ID to existing account:', user.email);
        }
      }

      // Create new user if still doesn't exist
      if (!user) {
        const userData = {
          name: name || 'Apple User',
          email: appleEmail || `${appleUserId}@appleid.private`, // Apple's private relay email
          appleId: appleUserId,
          password: Math.random().toString(36).slice(-16), // Random password (won't be used)
          emailVerified: true, // Trust Apple's verification
        };

        user = new User(userData);
        await user.save();
        console.log('✅ Created new user via Apple Sign In:', user.email);
      }
    } else {
      console.log('✅ Existing Apple user logged in:', user.email);
    }

    // Generate JWT tokens
    const { accessToken, refreshToken } = generateTokens(user._id.toString());

    // Save refresh token
    user.refreshToken = refreshToken;
    await user.save();

    // Return user data
    res.status(200).json({
      success: true,
      message: 'Apple Sign In successful',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          profileImage: user.avatar,
          isVerified: user.isVerified,
          createdAt: user.createdAt
        },
        tokens: {
          accessToken,
          refreshToken
        }
      }
    });

  } catch (error) {
    console.error('❌ Apple Sign In error:', error);
    res.status(500).json({
      success: false,
      message: 'Apple Sign In failed. Please try again.'
    });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email via Brevo
// @access  Public
router.post('/forgot-password', 
  passwordResetLimiter,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address')
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address',
          errors: errors.array()
        });
      }

      const { email } = req.body;

      // Find user by email
      const user = await User.findByEmail(email);
      
      // For security, always return success even if user doesn't exist
      // This prevents email enumeration attacks
      if (!user) {
        console.log('⚠️  Password reset requested for non-existent email:', email);
        return res.status(200).json({
          success: true,
          message: 'If an account with that email exists, we have sent a password reset link.'
        });
      }

      // Check if user signed up with social auth (no password)
      if (!user.password && (user.googleId || user.appleId || user.facebookId)) {
        console.log('⚠️  Password reset requested for social auth user:', email);
        return res.status(400).json({
          success: false,
          message: 'This account was created using social login (Google/Apple/Facebook). Please sign in using that method.'
        });
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      
      // Hash token before saving to database
      const hashedToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');

      // Save hashed token and expiration to database
      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
      await user.save();

      // Send email with plain token via Brevo
      try {
        await sendPasswordResetEmail(email, resetToken, user.name);
        
        console.log('✅ Password reset email sent via Brevo to:', email);
        res.status(200).json({
          success: true,
          message: 'Password reset link has been sent to your email address.'
        });
      } catch (emailError) {
        console.error('❌ Error sending password reset email via Brevo:', emailError);
        
        // Clear reset token if email fails
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        return res.status(500).json({
          success: false,
          message: 'Error sending password reset email. Please try again later or contact support.'
        });
      }

    } catch (error) {
      console.error('❌ Forgot password error:', error);
      res.status(500).json({
        success: false,
        message: 'An error occurred. Please try again later.'
      });
    }
  }
);

// @route   POST /api/auth/reset-password
// @desc    Reset password using token
// @access  Public
router.post('/reset-password',
  passwordResetLimiter,
  [
    body('token')
      .notEmpty()
      .withMessage('Reset token is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number')
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const errorMessages = errors.array().map(err => err.msg);
        return res.status(400).json({
          success: false,
          message: errorMessages.join('. '),
          errors: errors.array()
        });
      }

      const { token, newPassword } = req.body;

      // Hash the token to compare with database
      const hashedToken = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      // Find user with valid reset token
      const user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: Date.now() }
      }).select('+resetPasswordToken +resetPasswordExpires');

      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Password reset token is invalid or has expired. Please request a new one.'
        });
      }

      // Update password
      user.password = newPassword;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      console.log('✅ Password reset successful for user:', user.email);

      // Send confirmation email via Brevo (non-blocking)
      sendPasswordResetConfirmation(user.email, user.name).catch(err => {
        console.error('⚠️  Failed to send confirmation email via Brevo:', err);
      });

      res.status(200).json({
        success: true,
        message: 'Your password has been successfully reset. You can now log in with your new password.'
      });

    } catch (error) {
      console.error('❌ Reset password error:', error);
      res.status(500).json({
        success: false,
        message: 'An error occurred while resetting your password. Please try again.'
      });
    }
  }
);

// @route   GET /api/auth/verify-reset-token/:token
// @desc    Verify if reset token is valid
// @access  Public
router.get('/verify-reset-token/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Hash the token to compare with database
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with valid reset token
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token is invalid or has expired.'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Token is valid',
      data: {
        email: user.email
      }
    });

  } catch (error) {
    console.error('❌ Verify reset token error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while verifying the token.'
    });
  }
});

module.exports = router;