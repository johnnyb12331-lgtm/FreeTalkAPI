#!/usr/bin/env node

/**
 * Check video data and author avatars
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Import models in correct order
const User = require('../models/User');
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

async function checkVideoData() {
  console.log('🔍 Checking video data and author avatars...\n');
  
  // Get a few videos with populated authors
  const videos = await Video.find()
    .populate('author', 'name email avatar')
    .limit(5);
  
  console.log(`Found ${videos.length} videos\n`);
  
  videos.forEach((video, index) => {
    console.log(`Video ${index + 1}:`);
    console.log(`  Title: ${video.title}`);
    console.log(`  Video URL: ${video.videoUrl}`);
    console.log(`  Thumbnail: ${video.thumbnailUrl || 'N/A'}`);
    if (video.author) {
      console.log(`  Author: ${video.author.name}`);
      console.log(`  Author Avatar: ${video.author.avatar}`);
      
      // Check for malformed URLs
      if (video.author.avatar) {
        if (video.author.avatar.includes('https//') && !video.author.avatar.includes('https://')) {
          console.log(`  ⚠️  MALFORMED: Missing colon in https//`);
        } else if (video.author.avatar.includes('http//') && !video.author.avatar.includes('http://')) {
          console.log(`  ⚠️  MALFORMED: Missing colon in http//`);
        } else if (video.author.avatar.startsWith('http://') || video.author.avatar.startsWith('https://')) {
          console.log(`  ✅ URL format is correct`);
        } else {
          console.log(`  ℹ️  Relative URL`);
        }
      }
    }
    console.log('');
  });
  
  // Check for any videos with malformed URLs
  const malformedVideos = await Video.find({
    $or: [
      { videoUrl: /https\/\// },
      { videoUrl: /http\/\// },
      { thumbnailUrl: /https\/\// },
      { thumbnailUrl: /http\/\// }
    ]
  });
  
  const malformedUsers = await User.find({
    avatar: { $regex: /https\/\/|http\/\// }
  });
  
  console.log('📊 Summary:');
  console.log(`  Videos with malformed URLs: ${malformedVideos.length}`);
  console.log(`  Users with malformed avatars: ${malformedUsers.length}`);
  
  if (malformedUsers.length > 0) {
    console.log('\n⚠️  Found users with malformed avatars:');
    malformedUsers.forEach(user => {
      console.log(`  - ${user.name}: ${user.avatar}`);
    });
  }
}

async function main() {
  await connectDB();
  await checkVideoData();
  await mongoose.disconnect();
  console.log('\n✅ Done!\n');
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
