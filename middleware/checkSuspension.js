/**
 * Middleware to check if user is suspended and block certain actions
 * This is separate from auth.js to allow suspended users to login
 * but prevent them from creating/modifying content
 */

const checkSuspension = (req, res, next) => {
  // User should already be authenticated at this point
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  // Check if user is suspended
  if (req.user.isSuspended) {
    return res.status(403).json({
      success: false,
      message: 'Your account has been temporarily suspended. You cannot create posts, comment, like, or interact with content until your suspension is lifted.',
      isSuspended: true,
      suspensionReason: req.user.suspensionReason || 'Account suspended by administrator',
      canLogin: true, // They can still login and view content
      canInteract: false // But they cannot interact
    });
  }

  next();
};

module.exports = checkSuspension;
