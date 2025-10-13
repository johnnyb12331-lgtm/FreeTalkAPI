/**
 * Cleanup Script: Remove references to missing files
 * 
 * This script finds and optionally removes database references to files
 * that don't exist in the uploads directory.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

// Models
const User = require('../models/User');
const Post = require('../models/Post');
const Story = require('../models/Story');
const Message = require('../models/Message');
const Photo = require('../models/Photo');
const Video = require('../models/Video');
const MusicTrack = require('../models/MusicTrack');

// Path to uploads directory
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Statistics
const stats = {
  users: { checked: 0, missingAvatars: 0, missingBanners: 0, fixed: 0 },
  posts: { checked: 0, missingMedia: 0, fixed: 0 },
  stories: { checked: 0, missingMedia: 0, fixed: 0 },
  messages: { checked: 0, missingMedia: 0, fixed: 0 },
  photos: { checked: 0, missingFiles: 0, fixed: 0 },
  videos: { checked: 0, missingFiles: 0, fixed: 0 },
  music: { checked: 0, missingFiles: 0, fixed: 0 }
};

/**
 * Check if a file exists in the uploads directory
 */
function fileExists(filename) {
  if (!filename) return true; // null/empty is OK
  
  // Skip external URLs (they're not local files)
  if (filename.startsWith('http://') || filename.startsWith('https://')) {
    return true; // External URLs are always "valid"
  }
  
  // Extract just the filename if it's a full URL or path
  const match = filename.match(/\/uploads\/(.+)$/);
  const actualFilename = match ? match[1] : filename;
  
  const filePath = path.join(UPLOADS_DIR, actualFilename);
  return fs.existsSync(filePath);
}

/**
 * Clean users with missing avatar or feed banner images
 */
async function cleanUsers(dryRun = true) {
  console.log('\n🔍 Checking Users...');
  
  const users = await User.find({
    $or: [
      { avatar: { $exists: true, $ne: null, $ne: '' } },
      { feedBannerPhoto: { $exists: true, $ne: null, $ne: '' } }
    ]
  });
  
  stats.users.checked = users.length;
  
  for (const user of users) {
    let updated = false;
    
    // Check avatar
    if (user.avatar && !fileExists(user.avatar)) {
      console.log(`❌ User ${user.username} (${user._id}): Missing avatar ${user.avatar}`);
      stats.users.missingAvatars++;
      
      if (!dryRun) {
        user.avatar = null;
        updated = true;
      }
    }
    
    // Check feed banner
    if (user.feedBannerPhoto && !fileExists(user.feedBannerPhoto)) {
      console.log(`❌ User ${user.username} (${user._id}): Missing feed banner ${user.feedBannerPhoto}`);
      stats.users.missingBanners++;
      
      if (!dryRun) {
        user.feedBannerPhoto = null;
        updated = true;
      }
    }
    
    if (updated) {
      await user.save();
      stats.users.fixed++;
    }
  }
  
  console.log(`✅ Users checked: ${stats.users.checked}`);
  if (stats.users.missingAvatars > 0) {
    console.log(`   - Missing avatars: ${stats.users.missingAvatars}`);
  }
  if (stats.users.missingBanners > 0) {
    console.log(`   - Missing feed banners: ${stats.users.missingBanners}`);
  }
  if (!dryRun && stats.users.fixed > 0) {
    console.log(`   - Fixed: ${stats.users.fixed}`);
  }
}

/**
 * Clean posts with missing media
 */
async function cleanPosts(dryRun = true) {
  console.log('\n🔍 Checking Posts...');
  
  const posts = await Post.find({
    media: { $exists: true, $ne: null, $ne: [] }
  });
  
  stats.posts.checked = posts.length;
  
  for (const post of posts) {
    if (!post.media || post.media.length === 0) continue;
    
    const missingMedia = [];
    const validMedia = [];
    
    for (const mediaItem of post.media) {
      const filename = mediaItem.url || mediaItem;
      
      if (!fileExists(filename)) {
        console.log(`❌ Post ${post._id}: Missing media ${filename}`);
        stats.posts.missingMedia++;
        missingMedia.push(filename);
      } else {
        validMedia.push(mediaItem);
      }
    }
    
    if (missingMedia.length > 0 && !dryRun) {
      post.media = validMedia;
      await post.save();
      stats.posts.fixed++;
    }
  }
  
  console.log(`✅ Posts checked: ${stats.posts.checked}`);
  if (stats.posts.missingMedia > 0) {
    console.log(`   - Missing media files: ${stats.posts.missingMedia}`);
  }
  if (!dryRun && stats.posts.fixed > 0) {
    console.log(`   - Fixed: ${stats.posts.fixed}`);
  }
}

/**
 * Clean stories with missing media
 */
async function cleanStories(dryRun = true) {
  console.log('\n🔍 Checking Stories...');
  
  const stories = await Story.find({
    $or: [
      { mediaUrl: { $exists: true, $ne: null, $ne: '' } },
      { thumbnailUrl: { $exists: true, $ne: null, $ne: '' } }
    ]
  });
  
  stats.stories.checked = stories.length;
  
  for (const story of stories) {
    let updated = false;
    
    if (story.mediaUrl && !fileExists(story.mediaUrl)) {
      console.log(`❌ Story ${story._id}: Missing media ${story.mediaUrl}`);
      stats.stories.missingMedia++;
      
      if (!dryRun) {
        // Delete the entire story since media is essential
        await Story.deleteOne({ _id: story._id });
        stats.stories.fixed++;
        continue;
      }
    }
    
    if (story.thumbnailUrl && !fileExists(story.thumbnailUrl)) {
      console.log(`❌ Story ${story._id}: Missing thumbnail ${story.thumbnailUrl}`);
      stats.stories.missingMedia++;
      
      if (!dryRun) {
        story.thumbnailUrl = null;
        updated = true;
      }
    }
    
    if (updated) {
      await story.save();
      stats.stories.fixed++;
    }
  }
  
  console.log(`✅ Stories checked: ${stats.stories.checked}`);
  if (stats.stories.missingMedia > 0) {
    console.log(`   - Missing media files: ${stats.stories.missingMedia}`);
  }
  if (!dryRun && stats.stories.fixed > 0) {
    console.log(`   - Fixed: ${stats.stories.fixed}`);
  }
}

/**
 * Clean photos with missing files
 */
async function cleanPhotos(dryRun = true) {
  console.log('\n🔍 Checking Photos...');
  
  const photos = await Photo.find();
  stats.photos.checked = photos.length;
  
  for (const photo of photos) {
    if (!fileExists(photo.url)) {
      console.log(`❌ Photo ${photo._id}: Missing file ${photo.url}`);
      stats.photos.missingFiles++;
      
      if (!dryRun) {
        await Photo.deleteOne({ _id: photo._id });
        stats.photos.fixed++;
      }
    }
  }
  
  console.log(`✅ Photos checked: ${stats.photos.checked}`);
  if (stats.photos.missingFiles > 0) {
    console.log(`   - Missing files: ${stats.photos.missingFiles}`);
  }
  if (!dryRun && stats.photos.fixed > 0) {
    console.log(`   - Fixed: ${stats.photos.fixed}`);
  }
}

/**
 * Clean videos with missing files
 */
async function cleanVideos(dryRun = true) {
  console.log('\n🔍 Checking Videos...');
  
  const videos = await Video.find();
  stats.videos.checked = videos.length;
  
  for (const video of videos) {
    if (!fileExists(video.url)) {
      console.log(`❌ Video ${video._id}: Missing file ${video.url}`);
      stats.videos.missingFiles++;
      
      if (!dryRun) {
        await Video.deleteOne({ _id: video._id });
        stats.videos.fixed++;
      }
    }
  }
  
  console.log(`✅ Videos checked: ${stats.videos.checked}`);
  if (stats.videos.missingFiles > 0) {
    console.log(`   - Missing files: ${stats.videos.missingFiles}`);
  }
  if (!dryRun && stats.videos.fixed > 0) {
    console.log(`   - Fixed: ${stats.videos.fixed}`);
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--fix');
  
  console.log('🧹 Cleanup Missing Files Script');
  console.log('================================\n');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
    console.log('Run with --fix flag to actually clean the database\n');
  } else {
    console.log('⚠️  FIX MODE - Database will be updated!');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Check uploads directory
    if (!fs.existsSync(UPLOADS_DIR)) {
      console.error(`❌ Uploads directory not found: ${UPLOADS_DIR}`);
      process.exit(1);
    }
    console.log(`📁 Uploads directory: ${UPLOADS_DIR}\n`);
    
    // Run cleanup functions
    await cleanUsers(dryRun);
    await cleanPosts(dryRun);
    await cleanStories(dryRun);
    await cleanPhotos(dryRun);
    await cleanVideos(dryRun);
    
    // Print summary
    console.log('\n📊 Summary');
    console.log('==========');
    
    const totalChecked = 
      stats.users.checked + 
      stats.posts.checked + 
      stats.stories.checked + 
      stats.photos.checked + 
      stats.videos.checked;
    
    const totalMissing = 
      stats.users.missingAvatars + 
      stats.users.missingBanners + 
      stats.posts.missingMedia + 
      stats.stories.missingMedia + 
      stats.photos.missingFiles + 
      stats.videos.missingFiles;
    
    const totalFixed = 
      stats.users.fixed + 
      stats.posts.fixed + 
      stats.stories.fixed + 
      stats.photos.fixed + 
      stats.videos.fixed;
    
    console.log(`Total records checked: ${totalChecked}`);
    console.log(`Total missing files: ${totalMissing}`);
    
    if (!dryRun) {
      console.log(`Total records fixed: ${totalFixed}`);
    }
    
    if (dryRun && totalMissing > 0) {
      console.log('\n💡 Run with --fix to clean up these references');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run the script
main().catch(console.error);
