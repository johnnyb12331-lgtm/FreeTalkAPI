#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');

async function checkUrls() {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk';
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB\n');
    
    // Check user avatars
    console.log('👤 User Avatars (first 5):');
    const users = await User.find().select('name avatar').limit(5);
    users.forEach(u => {
      console.log(`  ${u.name}: ${u.avatar}`);
    });
    
    console.log('\n📝 Post Images (first 5):');
    const posts = await Post.find({ images: { $exists: true, $ne: [] } })
      .select('images author')
      .populate('author', 'name')
      .limit(5);
    
    posts.forEach(p => {
      console.log(`  Post by ${p.author?.name || 'Unknown'}:`);
      p.images.forEach(img => console.log(`    - ${img}`));
    });
    
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkUrls();
