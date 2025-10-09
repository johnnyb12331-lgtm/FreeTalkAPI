/**
 * Redis Cache Configuration and Utilities
 * 
 * This module provides caching functionality using Redis to improve
 * API performance by reducing database queries for frequently accessed data.
 * 
 * Usage:
 * 1. Install Redis: npm install redis
 * 2. Start Redis server locally or configure REDIS_URL in .env
 * 3. Import and use the cache middleware in routes
 * 
 * Note: Redis is optional. If not configured, the app will work without caching.
 */

let redis = null;
let isRedisAvailable = false;

try {
  // Only require redis if it's installed
  redis = require('redis');
  
  // Create Redis client
  const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => {
        if (retries > 3) {
          console.log('⚠️  Redis: Maximum reconnection attempts reached. Running without cache.');
          return false; // Stop reconnecting
        }
        return Math.min(retries * 100, 3000); // Exponential backoff
      }
    }
  });

  // Connect to Redis
  redisClient.connect()
    .then(() => {
      console.log('✅ Redis connected successfully');
      isRedisAvailable = true;
    })
    .catch((err) => {
      console.warn('⚠️  Redis connection failed. Running without cache:', err.message);
      isRedisAvailable = false;
    });

  // Handle Redis errors
  redisClient.on('error', (err) => {
    console.warn('⚠️  Redis error:', err.message);
    isRedisAvailable = false;
  });

  redisClient.on('ready', () => {
    console.log('✅ Redis client ready');
    isRedisAvailable = true;
  });

  redisClient.on('reconnecting', () => {
    console.log('🔄 Redis reconnecting...');
  });

  module.exports = { redisClient, isRedisAvailable: () => isRedisAvailable };

} catch (error) {
  // Redis is not installed or not available
  console.log('ℹ️  Redis is not installed. Running without cache. To enable caching, run: npm install redis');
  
  // Export dummy client that does nothing
  module.exports = {
    redisClient: {
      get: async () => null,
      set: async () => true,
      del: async () => true,
      setEx: async () => true,
      quit: async () => true,
    },
    isRedisAvailable: () => false
  };
}

/**
 * Cache Configuration
 */
const CACHE_TTL = {
  USER_PROFILE: 3600, // 1 hour
  POST: 300, // 5 minutes
  FEED: 60, // 1 minute
  NOTIFICATIONS: 30, // 30 seconds
  SEARCH_RESULTS: 300, // 5 minutes
  CONVERSATION: 120, // 2 minutes
  STORY: 300, // 5 minutes (stories are time-sensitive)
};

/**
 * Generate cache key with prefix
 */
const generateCacheKey = (prefix, id) => {
  return `freetalk:${prefix}:${id}`;
};

/**
 * Cache Helper Functions
 */
const cacheHelpers = {
  // Get from cache
  async get(key) {
    if (!isRedisAvailable) return null;
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.warn('Cache get error:', error.message);
      return null;
    }
  },

  // Set in cache with TTL
  async set(key, value, ttl = 300) {
    if (!isRedisAvailable) return false;
    try {
      await redisClient.setEx(key, ttl, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn('Cache set error:', error.message);
      return false;
    }
  },

  // Delete from cache
  async del(key) {
    if (!isRedisAvailable) return false;
    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      console.warn('Cache delete error:', error.message);
      return false;
    }
  },

  // Delete multiple keys matching pattern
  async delPattern(pattern) {
    if (!isRedisAvailable) return false;
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
      return true;
    } catch (error) {
      console.warn('Cache delete pattern error:', error.message);
      return false;
    }
  },

  // Clear user-related cache
  async clearUserCache(userId) {
    await this.delPattern(`freetalk:user:${userId}*`);
    await this.delPattern(`freetalk:feed:${userId}*`);
  },

  // Clear post-related cache
  async clearPostCache(postId) {
    await this.del(generateCacheKey('post', postId));
    await this.delPattern('freetalk:feed:*'); // Clear all feeds
  },
};

module.exports = {
  ...module.exports,
  CACHE_TTL,
  generateCacheKey,
  cacheHelpers,
};
