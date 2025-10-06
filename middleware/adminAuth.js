const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware to verify that the authenticated user has admin privileges
 * Must be used after authenticateToken middleware
 */
const requireAdmin = async (req, res, next) => {
  try {
    // Check if user was authenticated by authenticateToken middleware
    if (!req.user || !req.user._id) {
      return res.status(401).json({ 
        message: 'Authentication required' 
      });
    }

    // Fetch user from database to check admin status
    const user = await User.findById(req.user._id).select('isAdmin');
    
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found' 
      });
    }

    // Check if user has admin privileges
    if (!user.isAdmin) {
      return res.status(403).json({ 
        message: 'Access denied. Admin privileges required.' 
      });
    }

    // User is admin, proceed to next middleware/route handler
    next();
  } catch (error) {
    console.error('Admin auth middleware error:', error);
    res.status(500).json({ 
      message: 'Server error during authorization',
      error: error.message 
    });
  }
};

module.exports = requireAdmin;
