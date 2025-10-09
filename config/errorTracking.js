/**
 * Error Tracking Configuration
 * 
 * This module sets up error tracking and monitoring using Sentry
 * Helps track and debug errors in production
 * 
 * Setup:
 * 1. Install Sentry: npm install @sentry/node @sentry/profiling-node
 * 2. Sign up at https://sentry.io
 * 3. Create a new project for Node.js
 * 4. Add SENTRY_DSN to your .env file
 * 5. The module will automatically initialize if SENTRY_DSN is present
 * 
 * Note: Sentry is optional. If not configured, errors will only be logged to console.
 */

let Sentry = null;
let isSentryAvailable = false;

// Only load Sentry in production and if DSN is configured
const shouldUseSentry = process.env.NODE_ENV === 'production' && process.env.SENTRY_DSN;

if (shouldUseSentry) {
  try {
    // Try to load Sentry
    Sentry = require('@sentry/node');
    const ProfilingIntegration = require('@sentry/profiling-node').ProfilingIntegration;

    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      
      // Set sample rate for performance monitoring
      tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE 
        ? parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) 
        : 0.1, // 10% of transactions
      
      // Set sample rate for profiling
      profilesSampleRate: process.env.SENTRY_PROFILES_SAMPLE_RATE 
        ? parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE) 
        : 0.1, // 10% of transactions
      
      // Integrations
      integrations: [
        new ProfilingIntegration(),
      ],
      
      // Configure what data to send
      beforeSend(event, hint) {
        // Filter out specific errors if needed
        if (event.exception) {
          const error = hint.originalException;
          
          // Don't send validation errors to Sentry
          if (error && error.name === 'ValidationError') {
            return null;
          }
          
          // Don't send authentication errors
          if (error && (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError')) {
            return null;
          }
        }
        
        return event;
      },
      
      // Don't send sensitive data
      beforeBreadcrumb(breadcrumb) {
        // Remove sensitive data from breadcrumbs
        if (breadcrumb.category === 'http' && breadcrumb.data) {
          // Remove authorization headers
          if (breadcrumb.data.headers) {
            delete breadcrumb.data.headers.authorization;
            delete breadcrumb.data.headers.Authorization;
          }
        }
        return breadcrumb;
      },
    });

    isSentryAvailable = true;
    console.log('✅ Sentry error tracking initialized');

  } catch (error) {
    console.log('ℹ️  Sentry is not installed. To enable error tracking, run: npm install @sentry/node @sentry/profiling-node');
    isSentryAvailable = false;
  }
} else {
  console.log('ℹ️  Sentry error tracking disabled (not in production or SENTRY_DSN not set)');
}

/**
 * Express error handler middleware for Sentry
 */
const errorHandler = (err, req, res, next) => {
  // Log error to console
  console.error('❌ Error:', err);

  // Send error to Sentry if available
  if (isSentryAvailable && Sentry) {
    Sentry.captureException(err, {
      tags: {
        endpoint: req.path,
        method: req.method,
      },
      user: req.user ? {
        id: req.user._id || req.user.userId,
        email: req.user.email,
      } : undefined,
      extra: {
        body: req.body,
        query: req.query,
        params: req.params,
      },
    });
  }

  // Send error response to client
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * Manually capture exceptions
 */
const captureException = (error, context = {}) => {
  console.error('❌ Exception:', error);
  
  if (isSentryAvailable && Sentry) {
    Sentry.captureException(error, context);
  }
};

/**
 * Manually capture messages (for tracking non-error events)
 */
const captureMessage = (message, level = 'info', context = {}) => {
  console.log(`📝 ${level.toUpperCase()}: ${message}`);
  
  if (isSentryAvailable && Sentry) {
    Sentry.captureMessage(message, {
      level,
      ...context,
    });
  }
};

/**
 * Set user context for error tracking
 */
const setUser = (user) => {
  if (isSentryAvailable && Sentry) {
    Sentry.setUser({
      id: user._id || user.id,
      email: user.email,
      username: user.name || user.username,
    });
  }
};

/**
 * Clear user context (e.g., after logout)
 */
const clearUser = () => {
  if (isSentryAvailable && Sentry) {
    Sentry.setUser(null);
  }
};

/**
 * Request handler middleware (must be first)
 */
const requestHandler = isSentryAvailable && Sentry 
  ? Sentry.Handlers.requestHandler() 
  : (req, res, next) => next();

/**
 * Tracing middleware for performance monitoring
 */
const tracingHandler = isSentryAvailable && Sentry
  ? Sentry.Handlers.tracingHandler()
  : (req, res, next) => next();

/**
 * Error handler middleware (must be last)
 */
const sentryErrorHandler = isSentryAvailable && Sentry
  ? Sentry.Handlers.errorHandler()
  : (err, req, res, next) => next(err);

module.exports = {
  Sentry,
  isSentryAvailable,
  errorHandler,
  captureException,
  captureMessage,
  setUser,
  clearUser,
  requestHandler,
  tracingHandler,
  sentryErrorHandler,
};
