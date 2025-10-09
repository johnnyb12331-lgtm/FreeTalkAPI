const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Optional authentication middleware
 * Attaches user to request if valid token provided, but doesn't fail if not
 * Use this for endpoints that work for both authenticated and unauthenticated users
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader) {
      // No token provided - continue without user
      return next();
    }

    const token = authHeader.replace('Bearer ', '');
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');

      if (user) {
        req.user = user;
      }
    } catch (err) {
      // Invalid token - continue without user
      console.log('Invalid token in optionalAuth:', err.message);
    }
    
    next();
  } catch (error) {
    // Any error - just continue without user
    console.error('Error in optionalAuth:', error.message);
    next();
  }
};

module.exports = { optionalAuth };
