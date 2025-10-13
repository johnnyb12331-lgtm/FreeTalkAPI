#!/usr/bin/env node

/**
 * Clear Generated Content
 * Removes all posts and videos from the database
 * Useful for starting fresh or testing multiple times
 * 
 * Usage: node scripts/clear-content.js [--confirm]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Post = require('../models/Post');
const Video = require('../models/Video');
const readline = require('readline');

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

async function confirmDeletion() {
  const args = process.argv.slice(2);
  if (args.includes('--confirm')) {
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('\n⚠️  This will DELETE all posts and videos. Are you sure? (yes/no): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

async function clearContent() {
  console.log('🗑️  FreeTalk Content Cleaner\n');
  console.log('===============================');
  
  try {
    await connectDB();

    // Count existing content
    const postCount = await Post.countDocuments();
    const videoCount = await Video.countDocuments();

    console.log(`\n📊 Current Content:`);
    console.log(`   Posts: ${postCount}`);
    console.log(`   Videos: ${videoCount}`);

    if (postCount === 0 && videoCount === 0) {
      console.log('\n✨ Database is already empty!');
      return;
    }

    const confirmed = await confirmDeletion();

    if (!confirmed) {
      console.log('\n❌ Operation cancelled.');
      return;
    }

    console.log('\n🗑️  Deleting content...');

    // Delete posts
    const postsDeleted = await Post.deleteMany({});
    console.log(`✅ Deleted ${postsDeleted.deletedCount} posts`);

    // Delete videos
    const videosDeleted = await Video.deleteMany({});
    console.log(`✅ Deleted ${videosDeleted.deletedCount} videos`);

    console.log('\n===============================');
    console.log('✅ Content cleared successfully!');
    console.log('\n💡 Tip: Run "npm run seed" to generate new content');

  } catch (error) {
    console.error('\n❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Done!');
    process.exit(0);
  }
}

clearContent();
