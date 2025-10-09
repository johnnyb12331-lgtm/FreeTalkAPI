/**
 * Cache Middleware
 * 
 * Provides middleware functions to cache API responses using Redis
 * Falls back gracefully if Redis is not available
 */

const { cacheHelpers, generateCacheKey, CACHE_TTL, isRedisAvailable } = require('../config/redis');

/**
 * Generic cache middleware factory
 * @param {string} keyPrefix - Prefix for cache key (e.g., 'user', 'post')
 * @param {number} ttl - Time to live in seconds
 * @param {function} getKeyFromReq - Function to extract identifier from request
 */
const cacheMiddleware = (keyPrefix, ttl, getKeyFromReq) => {
  return async (req, res, next) => {
    // Skip caching if Redis is not available
    if (!isRedisAvailable()) {
      return next();
    }

    try {
      // Generate cache key from request
      const identifier = getKeyFromReq(req);
      if (!identifier) {
        return next(); // Can't cache without identifier
      }

      const cacheKey = generateCacheKey(keyPrefix, identifier);

      // Try to get from cache
      const cachedData = await cacheHelpers.get(cacheKey);
      
      if (cachedData) {
        console.log(`✅ Cache HIT: ${cacheKey}`);
        return res.json(cachedData);
      }

      console.log(`❌ Cache MISS: ${cacheKey}`);

      // Store original res.json to intercept response
      const originalJson = res.json.bind(res);
      
      // Override res.json to cache the response
      res.json = (data) => {
        // Only cache successful responses
        if (data && data.success !== false) {
          cacheHelpers.set(cacheKey, data, ttl)
            .catch(err => console.warn('Failed to cache response:', err.message));
        }
        return originalJson(data);
      };

      next();
    } catch (error) {
      console.warn('Cache middleware error:', error.message);
      next(); // Continue without caching on error
    }
  };
};

/**
 * Cache user profile
 * Usage: router.get('/profile/:id', cacheUserProfile, handler)
 */
const cacheUserProfile = cacheMiddleware(
  'user',
  CACHE_TTL.USER_PROFILE,
  (req) => req.params.id || req.params.userId || req.user?._id
);

/**
 * Cache single post
 * Usage: router.get('/posts/:id', cachePost, handler)
 */
const cachePost = cacheMiddleware(
  'post',
  CACHE_TTL.POST,
  (req) => req.params.id || req.params.postId
);

/**
 * Cache feed (includes pagination)
 * Usage: router.get('/posts', cacheFeed, handler)
 */
const cacheFeed = cacheMiddleware(
  'feed',
  CACHE_TTL.FEED,
  (req) => {
    const userId = req.user?._id;
    const page = req.query.page || 1;
    const limit = req.query.limit || 10;
    return `${userId}:p${page}:l${limit}`;
  }
);

/**
 * Cache notifications
 * Usage: router.get('/notifications', cacheNotifications, handler)
 */
const cacheNotifications = cacheMiddleware(
  'notifications',
  CACHE_TTL.NOTIFICATIONS,
  (req) => {
    const userId = req.user?._id;
    const page = req.query.page || 1;
    return `${userId}:p${page}`;
  }
);

/**
 * Cache search results
 * Usage: router.get('/search', cacheSearch, handler)
 */
const cacheSearch = cacheMiddleware(
  'search',
  CACHE_TTL.SEARCH_RESULTS,
  (req) => {
    const query = req.query.q || req.query.search;
    const page = req.query.page || 1;
    return query ? `${query}:p${page}` : null;
  }
);

/**
 * Cache conversations
 * Usage: router.get('/conversations', cacheConversations, handler)
 */
const cacheConversations = cacheMiddleware(
  'conversations',
  CACHE_TTL.CONVERSATION,
  (req) => {
    const userId = req.user?._id;
    const page = req.query.page || 1;
    return `${userId}:p${page}`;
  }
);

/**
 * Cache stories
 * Usage: router.get('/stories', cacheStories, handler)
 */
const cacheStories = cacheMiddleware(
  'stories',
  CACHE_TTL.STORY,
  (req) => {
    const userId = req.user?._id;
    return userId;
  }
);

/**
 * Middleware to invalidate cache after mutations
 * Usage: router.post('/posts', invalidateCache(['feed', 'user']), handler)
 */
const invalidateCache = (patterns = []) => {
  return async (req, res, next) => {
    // Store original methods
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    // Function to clear cache after successful response
    const clearCache = async () => {
      if (!isRedisAvailable()) return;

      try {
        for (const pattern of patterns) {
          await cacheHelpers.delPattern(`freetalk:${pattern}:*`);
          console.log(`🗑️  Cache invalidated: ${pattern}`);
        }
      } catch (error) {
        console.warn('Cache invalidation error:', error.message);
      }
    };

    // Override response methods
    res.json = function(data) {
      if (data && data.success !== false) {
        clearCache(); // Fire and forget
      }
      return originalJson(data);
    };

    res.send = function(data) {
      clearCache(); // Fire and forget
      return originalSend(data);
    };

    next();
  };
};

/**
 * Specific cache invalidation helpers
 */
const invalidateUserCache = (userId) => {
  return cacheHelpers.clearUserCache(userId);
};

const invalidatePostCache = (postId) => {
  return cacheHelpers.clearPostCache(postId);
};

module.exports = {
  cacheUserProfile,
  cachePost,
  cacheFeed,
  cacheNotifications,
  cacheSearch,
  cacheConversations,
  cacheStories,
  invalidateCache,
  invalidateUserCache,
  invalidatePostCache,
};
