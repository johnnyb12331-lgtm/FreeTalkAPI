#!/usr/bin/env node

/**
 * Fix External URL Protocols
 * Fixes URLs in the database that are missing the colon after http/https
 * Example: https//example.com -> https://example.com
 * 
 * Usage: node scripts/fix-external-url-protocols.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Video = require('../models/Video');
const Photo = require('../models/Photo');
const Story = require('../models/Story');

async function connectDB() {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk';
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

function fixUrlProtocol(url) {
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

async function fixUsers() {
  console.log('\n👤 Fixing User avatars...');
  const users = await User.find({ avatar: { $regex: /https?\/\// } });
  
  let fixed = 0;
  for (const user of users) {
    const oldAvatar = user.avatar;
    const newAvatar = fixUrlProtocol(user.avatar);
    
    if (oldAvatar !== newAvatar) {
      user.avatar = newAvatar;
      await user.save();
      console.log(`  ✅ Fixed: ${user.name}`);
      console.log(`     Old: ${oldAvatar}`);
      console.log(`     New: ${newAvatar}`);
      fixed++;
    }
  }
  
  console.log(`✅ Fixed ${fixed} user avatars`);
  return fixed;
}

async function fixPosts() {
  console.log('\n📝 Fixing Post images...');
  const posts = await Post.find({ images: { $regex: /https?\/\// } });
  
  let fixed = 0;
  for (const post of posts) {
    let modified = false;
    const newImages = post.images.map(img => {
      const fixedImg = fixUrlProtocol(img);
      if (fixedImg !== img) {
        modified = true;
        return fixedImg;
      }
      return img;
    });
    
    if (modified) {
      post.images = newImages;
      await post.save();
      console.log(`  ✅ Fixed post ${post._id}`);
      fixed++;
    }
  }
  
  console.log(`✅ Fixed ${fixed} posts`);
  return fixed;
}

async function fixVideos() {
  console.log('\n🎥 Fixing Video URLs and thumbnails...');
  const videos = await Video.find({
    $or: [
      { videoUrl: { $regex: /https?\/\// } },
      { thumbnailUrl: { $regex: /https?\/\// } }
    ]
  });
  
  let fixed = 0;
  for (const video of videos) {
    let modified = false;
    
    const newVideoUrl = fixUrlProtocol(video.videoUrl);
    if (newVideoUrl !== video.videoUrl) {
      video.videoUrl = newVideoUrl;
      modified = true;
    }
    
    const newThumbnailUrl = fixUrlProtocol(video.thumbnailUrl);
    if (newThumbnailUrl !== video.thumbnailUrl) {
      video.thumbnailUrl = newThumbnailUrl;
      modified = true;
    }
    
    if (modified) {
      await video.save();
      console.log(`  ✅ Fixed video ${video._id}`);
      fixed++;
    }
  }
  
  console.log(`✅ Fixed ${fixed} videos`);
  return fixed;
}

async function fixPhotos() {
  console.log('\n📷 Fixing Photo URLs...');
  const photos = await Photo.find({ url: { $regex: /https?\/\// } });
  
  let fixed = 0;
  for (const photo of photos) {
    const oldUrl = photo.url;
    const newUrl = fixUrlProtocol(photo.url);
    
    if (oldUrl !== newUrl) {
      photo.url = newUrl;
      await photo.save();
      console.log(`  ✅ Fixed photo ${photo._id}`);
      fixed++;
    }
  }
  
  console.log(`✅ Fixed ${fixed} photos`);
  return fixed;
}

async function fixStories() {
  console.log('\n📖 Fixing Story URLs...');
  const stories = await Story.find({
    $or: [
      { imageUrl: { $regex: /https?\/\// } },
      { videoUrl: { $regex: /https?\/\// } }
    ]
  });
  
  let fixed = 0;
  for (const story of stories) {
    let modified = false;
    
    if (story.imageUrl) {
      const newImageUrl = fixUrlProtocol(story.imageUrl);
      if (newImageUrl !== story.imageUrl) {
        story.imageUrl = newImageUrl;
        modified = true;
      }
    }
    
    if (story.videoUrl) {
      const newVideoUrl = fixUrlProtocol(story.videoUrl);
      if (newVideoUrl !== story.videoUrl) {
        story.videoUrl = newVideoUrl;
        modified = true;
      }
    }
    
    if (modified) {
      await story.save();
      console.log(`  ✅ Fixed story ${story._id}`);
      fixed++;
    }
  }
  
  console.log(`✅ Fixed ${fixed} stories`);
  return fixed;
}

async function main() {
  console.log('🔧 Starting URL Protocol Fix...\n');
  
  await connectDB();
  
  try {
    const totalUsers = await fixUsers();
    const totalPosts = await fixPosts();
    const totalVideos = await fixVideos();
    const totalPhotos = await fixPhotos();
    const totalStories = await fixStories();
    
    const grandTotal = totalUsers + totalPosts + totalVideos + totalPhotos + totalStories;
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ URL Fix Complete!');
    console.log(`   Total items fixed: ${grandTotal}`);
    console.log(`   - Users: ${totalUsers}`);
    console.log(`   - Posts: ${totalPosts}`);
    console.log(`   - Videos: ${totalVideos}`);
    console.log(`   - Photos: ${totalPhotos}`);
    console.log(`   - Stories: ${totalStories}`);
    console.log('='.repeat(50));
  } catch (error) {
    console.error('\n❌ Error during fix:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

main();
