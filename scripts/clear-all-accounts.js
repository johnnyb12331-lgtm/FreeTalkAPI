#!/usr/bin/env node

/**
 * Clear All User Accounts
 * Removes ALL users and related data from the database
 * ⚠️  DANGER: This is a destructive operation!
 * 
 * This script will delete:
 * - All user accounts
 * - All posts, videos, photos
 * - All messages and conversations
 * - All stories
 * - All notifications
 * - All pokes
 * - All reports and blocks
 * - All calls
 * - Profile visitors
 * 
 * Usage: node scripts/clear-all-accounts.js [--confirm]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');

// Import all models
const User = require('../models/User');
const Post = require('../models/Post');
const Video = require('../models/Video');
const Photo = require('../models/Photo');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Story = require('../models/Story');
const Notification = require('../models/Notification');
const Poke = require('../models/Poke');
const Report = require('../models/Report');
const Block = require('../models/Block');
const Call = require('../models/Call');
const ProfileVisitor = require('../models/ProfileVisitor');

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
    rl.question('\n⚠️  ⚠️  ⚠️  WARNING ⚠️  ⚠️  ⚠️\n\nThis will DELETE ALL ACCOUNTS and ALL DATA from the database!\nThis action CANNOT be undone!\n\nType "DELETE ALL" to confirm: ', (answer) => {
      rl.close();
      resolve(answer === 'DELETE ALL');
    });
  });
}

async function clearAllData() {
  console.log('🗑️  FreeTalk Account Cleaner\n');
  console.log('===============================');
  console.log('⚠️  DANGER ZONE - ALL DATA WILL BE DELETED');
  console.log('===============================\n');
  
  try {
    await connectDB();

    // Count existing data
    console.log('📊 Current Database Contents:\n');
    const userCount = await User.countDocuments();
    const postCount = await Post.countDocuments();
    const videoCount = await Video.countDocuments();
    const photoCount = await Photo.countDocuments();
    const messageCount = await Message.countDocuments();
    const conversationCount = await Conversation.countDocuments();
    const storyCount = await Story.countDocuments();
    const notificationCount = await Notification.countDocuments();
    const pokeCount = await Poke.countDocuments();
    const reportCount = await Report.countDocuments();
    const blockCount = await Block.countDocuments();
    const callCount = await Call.countDocuments();
    const visitorCount = await ProfileVisitor.countDocuments();

    console.log(`   👥 Users: ${userCount}`);
    console.log(`   📝 Posts: ${postCount}`);
    console.log(`   🎥 Videos: ${videoCount}`);
    console.log(`   📷 Photos: ${photoCount}`);
    console.log(`   💬 Messages: ${messageCount}`);
    console.log(`   💭 Conversations: ${conversationCount}`);
    console.log(`   📖 Stories: ${storyCount}`);
    console.log(`   🔔 Notifications: ${notificationCount}`);
    console.log(`   👉 Pokes: ${pokeCount}`);
    console.log(`   🚩 Reports: ${reportCount}`);
    console.log(`   🚫 Blocks: ${blockCount}`);
    console.log(`   📞 Calls: ${callCount}`);
    console.log(`   👁️  Profile Visitors: ${visitorCount}`);

    const totalItems = userCount + postCount + videoCount + photoCount + 
                       messageCount + conversationCount + storyCount + 
                       notificationCount + pokeCount + reportCount + 
                       blockCount + callCount + visitorCount;

    if (totalItems === 0) {
      console.log('\n✨ Database is already empty!');
      return;
    }

    console.log(`\n   📦 TOTAL ITEMS: ${totalItems}`);

    const confirmed = await confirmDeletion();

    if (!confirmed) {
      console.log('\n❌ Operation cancelled. Nothing was deleted.');
      return;
    }

    console.log('\n🗑️  Deleting all data...\n');

    // Delete in order (related data first, then users)
    
    console.log('   Deleting profile visitors...');
    const visitorsDeleted = await ProfileVisitor.deleteMany({});
    console.log(`   ✅ Deleted ${visitorsDeleted.deletedCount} profile visitors`);

    console.log('   Deleting calls...');
    const callsDeleted = await Call.deleteMany({});
    console.log(`   ✅ Deleted ${callsDeleted.deletedCount} calls`);

    console.log('   Deleting blocks...');
    const blocksDeleted = await Block.deleteMany({});
    console.log(`   ✅ Deleted ${blocksDeleted.deletedCount} blocks`);

    console.log('   Deleting reports...');
    const reportsDeleted = await Report.deleteMany({});
    console.log(`   ✅ Deleted ${reportsDeleted.deletedCount} reports`);

    console.log('   Deleting pokes...');
    const pokesDeleted = await Poke.deleteMany({});
    console.log(`   ✅ Deleted ${pokesDeleted.deletedCount} pokes`);

    console.log('   Deleting notifications...');
    const notificationsDeleted = await Notification.deleteMany({});
    console.log(`   ✅ Deleted ${notificationsDeleted.deletedCount} notifications`);

    console.log('   Deleting stories...');
    const storiesDeleted = await Story.deleteMany({});
    console.log(`   ✅ Deleted ${storiesDeleted.deletedCount} stories`);

    console.log('   Deleting messages...');
    const messagesDeleted = await Message.deleteMany({});
    console.log(`   ✅ Deleted ${messagesDeleted.deletedCount} messages`);

    console.log('   Deleting conversations...');
    const conversationsDeleted = await Conversation.deleteMany({});
    console.log(`   ✅ Deleted ${conversationsDeleted.deletedCount} conversations`);

    console.log('   Deleting photos...');
    const photosDeleted = await Photo.deleteMany({});
    console.log(`   ✅ Deleted ${photosDeleted.deletedCount} photos`);

    console.log('   Deleting videos...');
    const videosDeleted = await Video.deleteMany({});
    console.log(`   ✅ Deleted ${videosDeleted.deletedCount} videos`);

    console.log('   Deleting posts...');
    const postsDeleted = await Post.deleteMany({});
    console.log(`   ✅ Deleted ${postsDeleted.deletedCount} posts`);

    console.log('   Deleting users...');
    const usersDeleted = await User.deleteMany({});
    console.log(`   ✅ Deleted ${usersDeleted.deletedCount} users`);

    console.log('\n===============================');
    console.log('✅ ALL ACCOUNTS AND DATA CLEARED!');
    console.log('===============================');
    console.log('\n📊 Deletion Summary:');
    console.log(`   Total items deleted: ${
      usersDeleted.deletedCount + 
      postsDeleted.deletedCount + 
      videosDeleted.deletedCount + 
      photosDeleted.deletedCount + 
      messagesDeleted.deletedCount + 
      conversationsDeleted.deletedCount + 
      storiesDeleted.deletedCount + 
      notificationsDeleted.deletedCount + 
      pokesDeleted.deletedCount + 
      reportsDeleted.deletedCount + 
      blocksDeleted.deletedCount + 
      callsDeleted.deletedCount + 
      visitorsDeleted.deletedCount
    }`);
    console.log('\n💡 The database is now empty and ready for fresh accounts!');

  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error('Stack:', error.stack);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Database connection closed. Done!');
    process.exit(0);
  }
}

clearAllData();
