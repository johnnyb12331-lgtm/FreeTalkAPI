#!/usr/bin/env node

/**
 * Check Database Status
 * Shows count of all data in the database
 */

require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../models/User');
const Post = require('../models/Post');
const Video = require('../models/Video');
const Message = require('../models/Message');

async function checkDatabase() {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk';
    await mongoose.connect(mongoURI);
    
    const userCount = await User.countDocuments();
    const postCount = await Post.countDocuments();
    const videoCount = await Video.countDocuments();
    const messageCount = await Message.countDocuments();
    
    console.log('\n📊 Database Status:');
    console.log('==================');
    console.log(`Users: ${userCount}`);
    console.log(`Posts: ${postCount}`);
    console.log(`Videos: ${videoCount}`);
    console.log(`Messages: ${messageCount}`);
    console.log('==================\n');
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkDatabase();
