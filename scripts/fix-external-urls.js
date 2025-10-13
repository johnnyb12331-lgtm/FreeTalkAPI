#!/usr/bin/env node

/**
 * Fix External URLs in Database
 * Fixes malformed URLs (https// -> https://) in posts, videos, and user avatars
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Video = require('../models/Video');

async function connectDB() {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk';
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

function fixUrl(url) {
  if (!url || typeof url !== 'string') return url;
  
  // Fix https// -> https://
  if (url.includes('https//') && !url.includes('https://')) {
    return url.replace(/https\/\//g, 'https://');
  }
  
  // Fix http// -> http://
  if (url.includes('http//') && !url.includes('http://')) {
    return url.replace(/http\/\//g, 'http://');
  }
  
  return url;
}

async function fixUserAvatars() {
  console.log('🔧 Fixing user avatars...\n');
  
  const users = await User.find({ avatar: { $regex: /https\/\/|http\/\// } });
  console.log(`Found ${users.length} users with malformed avatar URLs`);
  
  let fixed = 0;
  for (const user of users) {
    const oldAvatar = user.avatar;
    user.avatar = fixUrl(user.avatar);
    
    if (oldAvatar !== user.avatar) {
      await user.save();
      console.log(`  ✅ Fixed ${user.name}: ${oldAvatar} -> ${user.avatar}`);
      fixed++;
    }
  }
  
  console.log(`✅ Fixed ${fixed} user avatars\n`);
  return fixed;
}

async function fixPostImages() {
  console.log('🔧 Fixing post images...\n');
  
  const posts = await Post.find({
    $or: [
      { 'images': { $regex: /https\/\/|http\/\// } }
    ]
  }).populate('author', 'name');
  
  console.log(`Found ${posts.length} posts with malformed image URLs`);
  
  let fixed = 0;
  for (const post of posts) {
    let changed = false;
    
    if (post.images && post.images.length > 0) {
      const oldImages = [...post.images];
      post.images = post.images.map(img => fixUrl(img));
      
      if (JSON.stringify(oldImages) !== JSON.stringify(post.images)) {
        changed = true;
      }
    }
    
    if (changed) {
      await post.save();
      console.log(`  ✅ Fixed post by ${post.author?.name || 'Unknown'}`);
      fixed++;
    }
  }
  
  console.log(`✅ Fixed ${fixed} posts\n`);
  return fixed;
}

async function fixVideoUrls() {
  console.log('🔧 Fixing video URLs...\n');
  
  const videos = await Video.find({
    $or: [
      { videoUrl: { $regex: /https\/\/|http\/\// } },
      { thumbnailUrl: { $regex: /https\/\/|http\/\// } }
    ]
  }).populate('author', 'name');
  
  console.log(`Found ${videos.length} videos with malformed URLs`);
  
  let fixed = 0;
  for (const video of videos) {
    let changed = false;
    const oldVideoUrl = video.videoUrl;
    const oldThumbnailUrl = video.thumbnailUrl;
    
    video.videoUrl = fixUrl(video.videoUrl);
    if (video.thumbnailUrl) {
      video.thumbnailUrl = fixUrl(video.thumbnailUrl);
    }
    
    if (oldVideoUrl !== video.videoUrl || oldThumbnailUrl !== video.thumbnailUrl) {
      await video.save();
      console.log(`  ✅ Fixed video by ${video.author?.name || 'Unknown'}: "${video.title}"`);
      if (oldVideoUrl !== video.videoUrl) {
        console.log(`     Video: ${oldVideoUrl} -> ${video.videoUrl}`);
      }
      if (oldThumbnailUrl !== video.thumbnailUrl) {
        console.log(`     Thumb: ${oldThumbnailUrl} -> ${video.thumbnailUrl}`);
      }
      fixed++;
    }
  }
  
  console.log(`✅ Fixed ${fixed} videos\n`);
  return fixed;
}

async function main() {
  console.log('🔧 Fixing External URLs in Database\n');
  console.log('='.repeat(60));
  
  await connectDB();
  
  const avatarsFixed = await fixUserAvatars();
  const postsFixed = await fixPostImages();
  const videosFixed = await fixVideoUrls();
  
  console.log('='.repeat(60));
  console.log('\n📊 SUMMARY:');
  console.log(`   User avatars fixed: ${avatarsFixed}`);
  console.log(`   Posts fixed: ${postsFixed}`);
  console.log(`   Videos fixed: ${videosFixed}`);
  console.log(`   Total: ${avatarsFixed + postsFixed + videosFixed}`);
  
  await mongoose.disconnect();
  console.log('\n✅ Done!\n');
}

main().catch(console.error);
