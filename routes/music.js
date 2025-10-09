const express = require('express');
const { body, validationResult } = require('express-validator');
const MusicTrack = require('../models/MusicTrack');
const Video = require('../models/Video');
const { authenticateToken } = require('../middleware/auth');
const upload = require('../config/multer');
const pixabayMusicService = require('../services/pixabayMusic');

const router = express.Router();

// Built-in music library data
const BUILT_IN_TRACKS = [
  {
    id: "alias_anno_domini",
    title: "Alias",
    artist: "Anno Domini Beats",
    filename: "Alias - Anno Domini Beats.mp3",
    duration: 180,
    category: "Electronic",
    mood: "Energetic",
    genre: "Electronic/Hip-Hop",
    license: "Royalty Free",
    description: "Upbeat electronic track perfect for action sequences"
  },
  {
    id: "cash_mark_karan",
    title: "Cash",
    artist: "Mark Karan, Scott Guberman, Angeline Saris, Jeremy Hoenig",
    filename: "Cash - Mark Karan, Scott Guberman, Angeline Saris, Jeremy Hoenig.mp3",
    duration: 165,
    category: "Pop",
    mood: "Confident",
    genre: "Pop/Rock",
    license: "Royalty Free",
    description: "Confident pop track with attitude"
  },
  {
    id: "circuit_rush",
    title: "Circuit Rush",
    artist: "The Mini Vandals",
    filename: "Circuit Rush - The Mini Vandals.mp3",
    duration: 195,
    category: "Electronic",
    mood: "Intense",
    genre: "Electronic/Dance",
    license: "Royalty Free",
    description: "High-energy electronic dance track"
  },
  {
    id: "final_boss_battle",
    title: "Final Boss Battle",
    artist: "Rod Kim",
    filename: "Final Boss Battle - Rod Kim.mp3",
    duration: 210,
    category: "Gaming",
    mood: "Epic",
    genre: "Orchestral/Electronic",
    license: "Royalty Free",
    description: "Epic battle music with orchestral elements"
  },
  {
    id: "fontana",
    title: "Fontana",
    artist: "Ryan Stasik, Kanika Moore",
    filename: "Fontana - Ryan Stasik, Kanika Moore.mp3",
    duration: 220,
    category: "Indie",
    mood: "Dreamy",
    genre: "Indie/Alternative", 
    license: "Royalty Free",
    description: "Dreamy indie track with atmospheric vibes"
  },
  {
    id: "love_fast",
    title: "Love Fast",
    artist: "Ryan Stasik, Kanika Moore",
    filename: "Love Fast - Ryan Stasik, Kanika Moore.mp3",
    duration: 185,
    category: "Pop",
    mood: "Romantic",
    genre: "Indie Pop",
    license: "Royalty Free",
    description: "Upbeat romantic indie pop track"
  },
  {
    id: "numb_sky",
    title: "Numb Sky",
    artist: "Mark Karan, Scott Guberman, Angeline Saris, Jeremy Hoenig",
    filename: "Numb Sky - Mark Karan, Scott Guberman, Angeline Saris, Jeremy Hoenig.mp3",
    duration: 200,
    category: "Alternative",
    mood: "Melancholy",
    genre: "Alternative Rock",
    license: "Royalty Free",
    description: "Moody alternative rock with emotional depth"
  },
  {
    id: "purple_desire",
    title: "Purple Desire",
    artist: "The Grey Room & Clark Sims",
    filename: "Purple Desire - The Grey Room _ Clark Sims.mp3",
    duration: 175,
    category: "Ambient",
    mood: "Mysterious",
    genre: "Ambient/Electronic",
    license: "Royalty Free",
    description: "Mysterious ambient track with electronic elements"
  },
  {
    id: "true_crime_documentary",
    title: "True Crime Documentary and Chill",
    artist: "Rod Kim",
    filename: "True Crime Documentary and Chill - Rod Kim.mp3",
    duration: 240,
    category: "Cinematic",
    mood: "Suspenseful",
    genre: "Cinematic/Ambient",
    license: "Royalty Free",
    description: "Suspenseful cinematic music perfect for storytelling"
  },
  {
    id: "uwu_victory",
    title: "uWu Victory",
    artist: "Rod Kim",
    filename: "uWu Victory - Rod Kim.mp3",
    duration: 120,
    category: "Gaming",
    mood: "Playful",
    genre: "Chiptune",
    license: "Royalty Free",
    description: "Playful victory theme with retro gaming vibes"
  }
];

// All routes require authentication
router.use(authenticateToken);

// @route   GET /api/music/built-in
// @desc    Get built-in music tracks 
// @access  Private
router.get('/built-in', async (req, res) => {
  try {
    const { category, mood, search } = req.query;
    let tracks = [...BUILT_IN_TRACKS];

    // Filter by category
    if (category) {
      tracks = tracks.filter(track => 
        track.category.toLowerCase() === category.toLowerCase()
      );
    }

    // Filter by mood
    if (mood) {
      tracks = tracks.filter(track => 
        track.mood.toLowerCase() === mood.toLowerCase()
      );
    }

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      tracks = tracks.filter(track => 
        track.title.toLowerCase().includes(searchLower) ||
        track.artist.toLowerCase().includes(searchLower) ||
        track.category.toLowerCase().includes(searchLower) ||
        track.mood.toLowerCase().includes(searchLower) ||
        track.genre.toLowerCase().includes(searchLower)
      );
    }

    res.status(200).json({
      success: true,
      message: 'Built-in tracks retrieved',
      data: {
        tracks,
        total: tracks.length
      }
    });
  } catch (error) {
    console.error('Built-in tracks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get built-in tracks'
    });
  }
});

// @route   GET /api/music/built-in/categories
// @desc    Get available categories from built-in tracks
// @access  Private
router.get('/built-in/categories', async (req, res) => {
  try {
    const categories = [...new Set(BUILT_IN_TRACKS.map(track => track.category))].sort();

    res.status(200).json({
      success: true,
      message: 'Categories retrieved',
      data: { categories }
    });
  } catch (error) {
    console.error('Categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get categories'
    });
  }
});

// @route   GET /api/music/built-in/moods
// @desc    Get available moods from built-in tracks
// @access  Private
router.get('/built-in/moods', async (req, res) => {
  try {
    const moods = [...new Set(BUILT_IN_TRACKS.map(track => track.mood))].sort();

    res.status(200).json({
      success: true,
      message: 'Moods retrieved',
      data: { moods }
    });
  } catch (error) {
    console.error('Moods error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get moods'
    });
  }
});

// @route   GET /api/music/built-in/:trackId
// @desc    Get specific built-in track by ID
// @access  Private
router.get('/built-in/:trackId', async (req, res) => {
  try {
    const { trackId } = req.params;
    const track = BUILT_IN_TRACKS.find(t => t.id === trackId);

    if (!track) {
      return res.status(404).json({
        success: false,
        message: 'Track not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Track retrieved',
      data: { track }
    });
  } catch (error) {
    console.error('Track retrieval error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get track'
    });
  }
});

// @route   GET /api/music/pixabay/search
// @desc    Search Pixabay for music (live from API)
// @access  Private
router.get('/pixabay/search', async (req, res) => {
  try {
    const { q = '', page = 1, limit = 20 } = req.query;

    const tracks = await pixabayMusicService.searchTracks({
      query: q,
      page: parseInt(page),
      perPage: parseInt(limit),
    });

    res.status(200).json({
      success: true,
      message: 'Pixabay search completed',
      data: {
        tracks,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: tracks.length,
        }
      }
    });
  } catch (error) {
    console.error('Pixabay search error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search Pixabay'
    });
  }
});

// @route   GET /api/music/pixabay/popular
// @desc    Get popular music from Pixabay (live from API)
// @access  Private
router.get('/pixabay/popular', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const tracks = await pixabayMusicService.getPopularTracks({
      page: parseInt(page),
      perPage: parseInt(limit),
    });

    res.status(200).json({
      success: true,
      message: 'Popular Pixabay tracks retrieved',
      data: {
        tracks,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: tracks.length,
        }
      }
    });
  } catch (error) {
    console.error('Pixabay popular error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get popular tracks from Pixabay'
    });
  }
});

// @route   POST /api/music/pixabay/sync
// @desc    Sync popular tracks from Pixabay to database (Admin)
// @access  Private
router.post('/pixabay/sync', async (req, res) => {
  try {
    const { count = 50 } = req.body;

    const result = await pixabayMusicService.syncPopularTracks(count);

    res.status(200).json({
      success: result.success,
      message: result.message || `Synced ${result.imported} tracks`,
      data: result
    });
  } catch (error) {
    console.error('Pixabay sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync Pixabay tracks'
    });
  }
});

// Validation rules
const createMusicTrackValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ max: 200 })
    .withMessage('Title cannot exceed 200 characters'),
  body('artist')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Artist name cannot exceed 200 characters'),
  body('duration')
    .isNumeric()
    .withMessage('Duration must be a number')
    .custom(value => value > 0 && value <= 300)
    .withMessage('Duration must be between 1 and 300 seconds'),
  body('category')
    .optional()
    .isIn(['trending', 'pop', 'hip-hop', 'rock', 'electronic', 'classical', 'jazz', 'country', 'r&b', 'indie', 'ambient', 'sound-effects', 'voiceover', 'other'])
    .withMessage('Invalid category')
];

// @route   GET /api/music/trending
// @desc    Get trending sounds/music
// @access  Public
router.get('/trending', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Check if MusicTrack.getTrending method exists
    if (typeof MusicTrack.getTrending === 'function') {
      const result = await MusicTrack.getTrending({
        page: parseInt(page),
        limit: parseInt(limit)
      });
      return res.status(200).json({
        success: true,
        message: 'Trending sounds retrieved successfully',
        data: result
      });
    }

    // Return empty result if method doesn't exist
    res.status(200).json({
      success: true,
      message: 'Trending sounds retrieved successfully',
      data: {
        tracks: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          pages: 0
        }
      }
    });
  } catch (error) {
    console.error('Get trending sounds error:', error);
    res.status(200).json({
      success: true,
      message: 'Trending sounds retrieved successfully',
      data: {
        tracks: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          pages: 0
        }
      }
    });
  }
});

// @route   GET /api/music/popular
// @desc    Get popular sounds/music
// @access  Private
router.get('/popular', async (req, res) => {
  try {
    const { page = 1, limit = 20, category } = req.query;

    const result = await MusicTrack.getPopular({
      page: parseInt(page),
      limit: parseInt(limit),
      category
    });

    res.status(200).json({
      success: true,
      message: 'Popular sounds retrieved successfully',
      data: result
    });
  } catch (error) {
    console.error('Get popular sounds error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve popular sounds'
    });
  }
});

// @route   GET /api/music/my-sounds
// @desc    Get user's uploaded sounds
// @access  Private (but returns empty if not authenticated)
router.get('/my-sounds', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Check if user is authenticated
    if (!req.user || !req.user._id) {
      return res.status(200).json({
        success: true,
        message: 'Your sounds retrieved successfully',
        data: {
          tracks: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
            pages: 0
          }
        }
      });
    }

    // Check if method exists
    if (typeof MusicTrack.getUserSounds === 'function') {
      const result = await MusicTrack.getUserSounds(req.user._id, {
        page: parseInt(page),
        limit: parseInt(limit)
      });
      return res.status(200).json({
        success: true,
        message: 'Your sounds retrieved successfully',
        data: result
      });
    }

    // Return empty if method doesn't exist
    res.status(200).json({
      success: true,
      message: 'Your sounds retrieved successfully',
      data: {
        tracks: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          pages: 0
        }
      }
    });
  } catch (error) {
    console.error('Get user sounds error:', error);
    res.status(200).json({
      success: true,
      message: 'Your sounds retrieved successfully',
      data: {
        tracks: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          pages: 0
        }
      }
    });
  }
});

// @route   GET /api/music/search
// @desc    Search for sounds/music
// @access  Private
router.get('/search', async (req, res) => {
  try {
    const { q, page = 1, limit = 20, category } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const result = await MusicTrack.searchSounds(q.trim(), {
      page: parseInt(page),
      limit: parseInt(limit),
      category
    });

    res.status(200).json({
      success: true,
      message: 'Search completed successfully',
      data: result,
      query: q.trim()
    });
  } catch (error) {
    console.error('Search sounds error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search sounds'
    });
  }
});

// @route   GET /api/music/categories
// @desc    Get all available categories
// @access  Private
router.get('/categories', async (req, res) => {
  try {
    const categories = [
      { id: 'trending', name: 'Trending', icon: '🔥' },
      { id: 'pop', name: 'Pop', icon: '🎵' },
      { id: 'hip-hop', name: 'Hip-Hop', icon: '🎤' },
      { id: 'rock', name: 'Rock', icon: '🎸' },
      { id: 'electronic', name: 'Electronic', icon: '🎧' },
      { id: 'classical', name: 'Classical', icon: '🎻' },
      { id: 'jazz', name: 'Jazz', icon: '🎺' },
      { id: 'country', name: 'Country', icon: '🤠' },
      { id: 'r&b', name: 'R&B', icon: '💿' },
      { id: 'indie', name: 'Indie', icon: '🎹' },
      { id: 'ambient', name: 'Ambient', icon: '🌊' },
      { id: 'sound-effects', name: 'Sound Effects', icon: '🔊' },
      { id: 'voiceover', name: 'Voiceover', icon: '🎙️' },
      { id: 'other', name: 'Other', icon: '🎶' }
    ];

    res.status(200).json({
      success: true,
      data: { categories }
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve categories'
    });
  }
});

// @route   GET /api/music/:id
// @desc    Get single music track by ID
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid music track ID format'
      });
    }

    const track = await MusicTrack.findById(req.params.id)
      .populate('uploadedBy', 'name email avatar');

    if (!track || track.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Music track not found'
      });
    }

    // Get videos using this sound
    const videosUsingSound = await Video.countDocuments({
      'audioTrack.musicTrackId': track._id,
      isDeleted: false
    });

    res.status(200).json({
      success: true,
      message: 'Music track retrieved successfully',
      data: {
        track: track.toJSON(),
        videosUsingSound
      }
    });
  } catch (error) {
    console.error('Get music track error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve music track'
    });
  }
});

// @route   POST /api/music/upload
// @desc    Upload a user-created sound/audio
// @access  Private
router.post('/upload', upload.single('audio'), createMusicTrackValidation, async (req, res) => {
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

    // Check if audio file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Audio file is required'
      });
    }

    // Validate file type
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/m4a'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid audio format. Only MP3, WAV, OGG, AAC, and M4A are allowed'
      });
    }

    const { title, artist, duration, category, description, tags } = req.body;

    // Parse tags if provided
    let parsedTags = [];
    if (tags) {
      try {
        parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
      } catch (e) {
        console.error('Error parsing tags:', e);
      }
    }

    // Create audio URL
    const audioUrl = `/uploads/${req.file.filename}`;

    // Determine audio format from mimetype
    let format = 'mp3';
    if (req.file.mimetype.includes('wav')) format = 'wav';
    else if (req.file.mimetype.includes('ogg')) format = 'ogg';
    else if (req.file.mimetype.includes('aac')) format = 'aac';
    else if (req.file.mimetype.includes('m4a')) format = 'm4a';

    // Create new music track
    const musicTrack = new MusicTrack({
      title,
      artist: artist || req.user.name,
      url: audioUrl,
      duration: parseFloat(duration),
      category: category || 'other',
      source: 'user',
      uploadedBy: req.user._id,
      description,
      tags: parsedTags,
      fileSize: req.file.size,
      format,
      license: 'User-generated content - Rights owned by uploader',
      isApproved: true // Auto-approve user content (add moderation later if needed)
    });

    await musicTrack.save();

    console.log(`🎵 User ${req.user.name} uploaded sound: ${title}`);

    res.status(201).json({
      success: true,
      message: 'Sound uploaded successfully',
      data: { track: musicTrack }
    });
  } catch (error) {
    console.error('Upload sound error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload sound'
    });
  }
});

// @route   GET /api/music/:id/videos
// @desc    Get videos using a specific sound
// @access  Private
router.get('/:id/videos', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const videos = await Video.find({
      'audioTrack.musicTrackId': req.params.id,
      isDeleted: false
    })
      .populate('author', 'name email avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Video.countDocuments({
      'audioTrack.musicTrackId': req.params.id,
      isDeleted: false
    });

    res.status(200).json({
      success: true,
      message: 'Videos retrieved successfully',
      data: {
        videos,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get sound videos error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve videos'
    });
  }
});

// @route   DELETE /api/music/:id
// @desc    Delete a user's uploaded sound
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const track = await MusicTrack.findById(req.params.id);

    if (!track || track.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Music track not found'
      });
    }

    // Check if user is the uploader
    if (track.uploadedBy.toString() !== req.user._id.toString() && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this sound'
      });
    }

    // Soft delete
    track.isDeleted = true;
    await track.save();

    console.log(`🗑️ User ${req.user.name} deleted sound: ${track.title}`);

    res.status(200).json({
      success: true,
      message: 'Sound deleted successfully'
    });
  } catch (error) {
    console.error('Delete sound error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete sound'
    });
  }
});

// @route   GET /api/music/built-in/stream/:filename
// @desc    Stream built-in music file by filename (supports range requests)
// @access  Private
// OPTIONS handler for CORS preflight
router.options('/built-in/stream/:filename', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.status(200).end();
});

router.get('/built-in/stream/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const path = require('path');
    const fs = require('fs');

    // Set CORS headers for streaming (important for web browsers)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

    // Allow only .mp3 filenames with safe characters
    if (!/^[a-zA-Z0-9\s\-_()&,.]+\.mp3$/i.test(filename)) {
      return res.status(400).json({ success: false, message: 'Invalid filename' });
    }

    const musicPath = path.join(__dirname, '../uploads/music', filename);

    if (!fs.existsSync(musicPath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    const stat = fs.statSync(musicPath);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

      if (isNaN(start) || isNaN(end) || start > end || end >= stat.size) {
        return res.status(416).set({
          'Content-Range': `bytes */${stat.size}`
        }).end();
      }

      const chunkSize = (end - start) + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=31536000'
      });
      fs.createReadStream(musicPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000'
      });
      fs.createReadStream(musicPath).pipe(res);
    }
  } catch (error) {
    console.error('Built-in stream error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
