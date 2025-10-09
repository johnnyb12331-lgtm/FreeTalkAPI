/**
 * Bulk Import Music Tracks Script
 * 
 * This script imports music files from a directory into the database.
 * 
 * Usage:
 *   node scripts/import-music.js <source-directory>
 * 
 * Example:
 *   node scripts/import-music.js "C:\Users\benne\Desktop\MusicFolder"
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const MusicTrack = require('../models/MusicTrack');

// Supported audio formats
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

/**
 * Parse filename to extract metadata
 * Expected formats:
 * - "Artist - Title.mp3"
 * - "Title.mp3"
 * - "01 - Artist - Title.mp3"
 */
function parseFilename(filename) {
  const nameWithoutExt = path.parse(filename).name;
  
  // Remove leading numbers (e.g., "01 - ")
  let cleaned = nameWithoutExt.replace(/^\d+\s*[-._]\s*/, '');
  
  // Try to split by " - " for Artist - Title format
  const parts = cleaned.split(' - ');
  
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(' - ').trim()
    };
  } else {
    return {
      artist: 'Unknown Artist',
      title: cleaned.trim()
    };
  }
}

/**
 * Get audio duration using a simple estimation
 * For more accurate duration, you'd need a library like 'music-metadata'
 * For now, we'll set a default duration
 */
function estimateDuration(filePath) {
  const stats = fs.statSync(filePath);
  const fileSizeInMB = stats.size / (1024 * 1024);
  
  // Rough estimate: MP3 at 128kbps ≈ 1MB per minute
  // This is very approximate; consider installing 'music-metadata' for accuracy
  const estimatedDuration = Math.round(fileSizeInMB * 60);
  
  // Cap between 10 and 300 seconds if seems unreasonable
  if (estimatedDuration < 10) return 30; // Default to 30s for small files
  if (estimatedDuration > 300) return 180; // Cap at 3 minutes
  
  return estimatedDuration;
}

/**
 * Categorize track based on filename keywords
 */
function categorizeTrack(title, artist) {
  const text = `${title} ${artist}`.toLowerCase();
  
  if (text.match(/hip[\s-]?hop|rap|trap|drill/)) return 'hip-hop';
  if (text.match(/rock|metal|punk|grunge/)) return 'rock';
  if (text.match(/pop|dance|edm|house|electro/)) return 'pop';
  if (text.match(/jazz|blues|soul/)) return 'jazz';
  if (text.match(/classic|orchestra|symphony/)) return 'classical';
  if (text.match(/country|folk|acoustic/)) return 'country';
  if (text.match(/latin|reggae|world/)) return 'latin';
  if (text.match(/ambient|chill|relax|meditation/)) return 'ambient';
  if (text.match(/cinematic|epic|trailer|soundtrack/)) return 'cinematic';
  if (text.match(/inspire|motivat|uplifting/)) return 'inspirational';
  if (text.match(/fun|happy|party|upbeat/)) return 'fun';
  if (text.match(/lofi|lo-fi|study|beats/)) return 'lofi';
  
  return 'other'; // Default category
}

/**
 * Copy file to uploads/music directory
 */
function copyAudioFile(sourcePath, filename) {
  const destDir = path.join(__dirname, '../uploads/music');
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  // Generate unique filename to avoid collisions
  const timestamp = Date.now();
  const ext = path.extname(filename);
  const nameWithoutExt = path.parse(filename).name.replace(/[^a-zA-Z0-9-_]/g, '_');
  const newFilename = `${nameWithoutExt}_${timestamp}${ext}`;
  const destPath = path.join(destDir, newFilename);
  
  // Copy file
  fs.copyFileSync(sourcePath, destPath);
  
  // Return URL path (relative to server)
  return `/uploads/music/${newFilename}`;
}

/**
 * Import a single music file
 */
async function importMusicFile(filePath, options = {}) {
  try {
    const filename = path.basename(filePath);
    const { artist, title } = parseFilename(filename);
    
    console.log(`📝 Processing: ${filename}`);
    console.log(`   Artist: ${artist}`);
    console.log(`   Title: ${title}`);
    
    // Copy file to uploads directory
    const url = copyAudioFile(filePath, filename);
    console.log(`   URL: ${url}`);
    
    // Get duration
    const duration = options.duration || estimateDuration(filePath);
    console.log(`   Duration: ${duration}s`);
    
    // Categorize
    const category = options.category || categorizeTrack(title, artist);
    console.log(`   Category: ${category}`);
    
    // Check if already exists
    const existing = await MusicTrack.findOne({ title, artist });
    if (existing) {
      console.log(`   ⚠️  Already exists in database, skipping...`);
      return null;
    }
    
    // Create database entry
    const musicTrack = new MusicTrack({
      title,
      artist,
      url,
      duration,
      category,
      source: options.source || 'manual-import',
      license: options.license || 'Free to use with attribution',
      requiresAttribution: options.requiresAttribution !== false,
      externalId: null,
      externalUrl: null,
      tags: options.tags || [category, artist.toLowerCase(), title.toLowerCase().split(' ')[0]],
      usageCount: 0,
      isPopular: false,
      isTrending: false
    });
    
    await musicTrack.save();
    console.log(`   ✅ Imported successfully!`);
    
    return musicTrack;
  } catch (error) {
    console.error(`   ❌ Error importing ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Import all music files from a directory
 */
async function importDirectory(sourceDir, options = {}) {
  console.log(`\n🎵 Importing music from: ${sourceDir}\n`);
  
  if (!fs.existsSync(sourceDir)) {
    console.error(`❌ Directory not found: ${sourceDir}`);
    process.exit(1);
  }
  
  const files = fs.readdirSync(sourceDir);
  const audioFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
  });
  
  console.log(`Found ${audioFiles.length} audio files\n`);
  
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const file of audioFiles) {
    const filePath = path.join(sourceDir, file);
    const result = await importMusicFile(filePath, options);
    
    if (result) {
      imported++;
    } else if (result === null) {
      skipped++;
    } else {
      errors++;
    }
    
    console.log(''); // Blank line between files
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`✅ Import complete!`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log('='.repeat(50) + '\n');
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
🎵 Music Import Script
=====================

Usage:
  node scripts/import-music.js <source-directory> [options]

Examples:
  node scripts/import-music.js "C:\\Users\\benne\\Desktop\\Music"
  node scripts/import-music.js "../Music" --source="YouTube Audio Library"
  node scripts/import-music.js "./music-files" --category=pop

Options:
  --source=<name>          Source name (default: "manual-import")
  --license=<text>         License text (default: "Free to use with attribution")
  --category=<category>    Force all tracks to this category
  --no-attribution         Set requiresAttribution to false
  --duration=<seconds>     Set duration for all tracks

Supported categories:
  pop, rock, hip-hop, jazz, classical, electronic, country, 
  latin, ambient, cinematic, inspirational, fun, lofi, other
    `);
    process.exit(0);
  }
  
  const sourceDir = args[0];
  
  // Parse options
  const options = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--source=')) {
      options.source = arg.split('=')[1];
    } else if (arg.startsWith('--license=')) {
      options.license = arg.split('=')[1];
    } else if (arg.startsWith('--category=')) {
      options.category = arg.split('=')[1];
    } else if (arg.startsWith('--duration=')) {
      options.duration = parseInt(arg.split('=')[1]);
    } else if (arg === '--no-attribution') {
      options.requiresAttribution = false;
    }
  }
  
  await importDirectory(sourceDir, options);
  
  // Close MongoDB connection
  await mongoose.connection.close();
  console.log('👋 Database connection closed');
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { importDirectory, importMusicFile };
