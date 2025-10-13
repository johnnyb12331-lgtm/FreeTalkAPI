#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');

async function findMalformedUrls() {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk';
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB\n');
    
    // Check for URLs with https// (no colon)
    console.log('🔍 Searching for malformed URLs...\n');
    
    // Check users with malformed avatars
    const usersWithBadAvatars = await User.find({
      avatar: { $regex: /https\/\// }
    }).select('name avatar');
    
    if (usersWithBadAvatars.length > 0) {
      console.log(`👤 Found ${usersWithBadAvatars.length} users with malformed avatars:`);
      usersWithBadAvatars.forEach(u => {
        console.log(`  ${u.name}: ${u.avatar}`);
      });
    } else {
      console.log('✅ No users with malformed avatars found');
    }
    
    // Check posts with malformed images
    const postsWithBadImages = await Post.find({
      images: { $regex: /https\/\// }
    }).populate('author', 'name').limit(10);
    
    if (postsWithBadImages.length > 0) {
      console.log(`\n📝 Found ${postsWithBadImages.length} posts with malformed images:`);
      postsWithBadImages.forEach(p => {
        console.log(`  Post by ${p.author?.name || 'Unknown'}:`);
        p.images.forEach(img => {
          if (img.includes('https//')) {
            console.log(`    ❌ ${img}`);
          }
        });
      });
    } else {
      console.log('\n✅ No posts with malformed images found');
    }
    
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

findMalformedUrls();
