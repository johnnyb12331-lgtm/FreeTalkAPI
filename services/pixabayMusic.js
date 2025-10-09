const axios = require('axios');
const MusicTrack = require('../models/MusicTrack');

class PixabayMusicService {
  constructor() {
    this.apiKey = process.env.PIXABAY_API_KEY;
    this.baseUrl = 'https://pixabay.com/api/'; // Note: Pixabay doesn't have a public audio API yet
    this.enabled = false; // Disabled until Pixabay releases audio API
    
    // Alternative: Use images/videos API or wait for audio API
    
    if (!this.enabled) {
      console.log('⚠️  Pixabay Music API is disabled. Set PIXABAY_API_KEY and PIXABAY_AUDIO_ENABLED=true in .env');
    } else {
      console.log('✅ Pixabay Music API is enabled');
    }
  }

  /**
   * Search for audio tracks on Pixabay
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Array of tracks
   */
  async searchTracks(options = {}) {
    if (!this.enabled) {
      return [];
    }

    try {
      const {
        query = '',
        page = 1,
        perPage = 20,
        audioType = 'music', // music or sound_effect
      } = options;

      const response = await axios.get(`${this.baseUrl}`, {
        params: {
          key: this.apiKey,
          q: query,
          page,
          per_page: perPage,
          audio_type: audioType,
        },
        timeout: 10000,
      });

      if (response.data && response.data.hits) {
        return response.data.hits.map(track => this.formatTrack(track));
      }

      return [];
    } catch (error) {
      console.error('Pixabay API error:', error.message);
      return [];
    }
  }

  /**
   * Get popular tracks from Pixabay
   * @param {Object} options - Options
   * @returns {Promise<Array>} Array of tracks
   */
  async getPopularTracks(options = {}) {
    if (!this.enabled) {
      return [];
    }

    try {
      const {
        page = 1,
        perPage = 20,
        audioType = 'music',
      } = options;

      const response = await axios.get(`${this.baseUrl}`, {
        params: {
          key: this.apiKey,
          page,
          per_page: perPage,
          audio_type: audioType,
          order: 'popular', // Order by popularity
        },
        timeout: 10000,
      });

      if (response.data && response.data.hits) {
        return response.data.hits.map(track => this.formatTrack(track));
      }

      return [];
    } catch (error) {
      console.error('Pixabay API error:', error.message);
      return [];
    }
  }

  /**
   * Format Pixabay track data to our schema
   * @param {Object} track - Pixabay track object
   * @returns {Object} Formatted track
   */
  formatTrack(track) {
    return {
      title: track.name || 'Untitled',
      artist: track.user?.name || 'Pixabay Audio',
      url: track.audio?.mp3 || track.audio?.url || track.previewURL,
      duration: track.duration || 30,
      category: this.mapGenreToCategory(track.genre),
      source: 'pixabay',
      license: 'Pixabay License - Free for commercial use, no attribution required',
      licenseUrl: 'https://pixabay.com/service/license-audio/',
      externalId: track.id.toString(),
      externalUrl: track.pageURL,
      tags: track.tags ? track.tags.split(',').map(t => t.trim()) : [],
      fileSize: null,
      format: 'mp3',
      isApproved: true,
      isPopular: track.likes > 100,
      usageCount: 0, // Will be tracked internally
    };
  }

  /**
   * Map Pixabay genre to our categories
   * @param {string} genre - Pixabay genre
   * @returns {string} Our category
   */
  mapGenreToCategory(genre) {
    const genreMap = {
      'pop': 'pop',
      'rock': 'rock',
      'jazz': 'jazz',
      'classical': 'classical',
      'electronic': 'electronic',
      'hip hop': 'hip-hop',
      'country': 'country',
      'rnb': 'r&b',
      'indie': 'indie',
      'ambient': 'ambient',
    };

    const lowerGenre = (genre || '').toLowerCase();
    return genreMap[lowerGenre] || 'other';
  }

  /**
   * Import Pixabay tracks to our database
   * @param {Array} tracks - Tracks to import
   * @returns {Promise<Array>} Imported track IDs
   */
  async importTracksToDatabase(tracks) {
    const importedIds = [];

    for (const trackData of tracks) {
      try {
        // Check if track already exists
        const existing = await MusicTrack.findOne({
          source: 'pixabay',
          externalId: trackData.externalId,
        });

        if (existing) {
          console.log(`Track already exists: ${trackData.title}`);
          importedIds.push(existing._id);
          continue;
        }

        // Create new track
        const track = new MusicTrack(trackData);
        await track.save();
        
        console.log(`✅ Imported: ${trackData.title}`);
        importedIds.push(track._id);
      } catch (error) {
        console.error(`Failed to import track ${trackData.title}:`, error.message);
      }
    }

    return importedIds;
  }

  /**
   * Sync popular tracks from Pixabay to database
   * @param {number} count - Number of tracks to sync
   * @returns {Promise<Object>} Sync result
   */
  async syncPopularTracks(count = 50) {
    if (!this.enabled) {
      return {
        success: false,
        message: 'Pixabay API is not enabled',
      };
    }

    try {
      console.log('🔄 Syncing popular tracks from Pixabay...');

      const tracks = await this.getPopularTracks({
        perPage: count,
      });

      const importedIds = await this.importTracksToDatabase(tracks);

      console.log(`✅ Synced ${importedIds.length} tracks from Pixabay`);

      return {
        success: true,
        imported: importedIds.length,
        tracks: importedIds,
      };
    } catch (error) {
      console.error('Pixabay sync error:', error);
      return {
        success: false,
        message: error.message,
      };
    }
  }
}

module.exports = new PixabayMusicService();
