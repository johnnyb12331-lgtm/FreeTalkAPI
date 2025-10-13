#!/usr/bin/env node

/**
 * Quick Start - Populate Feed with Sample Content
 * This script works WITHOUT any AI API keys - perfect for quick testing!
 * 
 * Usage: node scripts/quick-start-content.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Video = require('../models/Video');

// Sample content templates
const POST_TEMPLATES = [
  "Just discovered something amazing! The possibilities are endless when you keep an open mind. 🌟",
  "Taking a moment to appreciate the little things in life. What made you smile today? 😊",
  "New day, new opportunities! Let's make it count! 💪",
  "Sometimes the best moments are the unexpected ones. Loving this journey! ✨",
  "Grateful for all the wonderful people in my life. You know who you are! ❤️",
  "Weekend vibes hitting different! Time to relax and recharge. 🌴",
  "Just finished an amazing project! Hard work really does pay off. 🎉",
  "Coffee in hand, ready to conquer the day! ☕ Who's with me?",
  "Life update: Still figuring it out, but enjoying every moment! 🚀",
  "That feeling when everything just clicks. Today was a good day! 🌈",
  "Trying something new today! Step out of your comfort zone! 🎯",
  "Sunset views never get old. Nature is the best artist! 🌅",
  "Working on myself, by myself, for myself. Self-love journey! 💫",
  "Good vibes only! Surrounding myself with positive energy. ✌️",
  "Late night thoughts: Everything happens for a reason. Trust the process! 🌙",
  "Can't stop, won't stop! Chasing dreams and making them reality! 🔥",
  "Feeling blessed and highly favored today! Counting my blessings! 🙏",
  "New week, new goals! Let's crush this week together! 💪",
  "Sometimes you need to disconnect to reconnect. Digital detox vibes! 📵",
  "Life is short, make every moment count! Living my best life! 🎊"
];

const VIDEO_DATA = [
  { title: "10 Life Hacks You Need to Try!", description: "Simple tricks that will change your daily routine forever!" },
  { title: "My Morning Routine 2025", description: "Start your day right with these productivity tips!" },
  { title: "Easy 15-Minute Recipe", description: "Delicious meal that anyone can make! Perfect for busy days." },
  { title: "Day in My Life", description: "Follow me around for a day! Real, unfiltered, and fun!" },
  { title: "This Changed Everything!", description: "The one thing that completely transformed my perspective." },
  { title: "Quick Home Workout", description: "No equipment needed! Get fit at home in just 20 minutes." },
  { title: "Travel Vlog: Hidden Gems", description: "Exploring places you've never heard of but need to visit!" },
  { title: "Tech Tips & Tricks", description: "Make your phone work smarter, not harder!" },
  { title: "Real Talk: Honest Thoughts", description: "Sometimes we need to keep it real. Here's my honest opinion." },
  { title: "Relaxing Music Session", description: "Chill vibes and good music. Perfect for studying or relaxing!" }
];

const SAMPLE_IMAGES = [
  'https://picsum.photos/seed/social1/800/600',
  'https://picsum.photos/seed/social2/800/600',
  'https://picsum.photos/seed/social3/800/600',
  'https://picsum.photos/seed/social4/800/600',
  'https://picsum.photos/seed/social5/800/600'
];

const SAMPLE_VIDEOS = [
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4'
];

const SAMPLE_THUMBNAILS = [
  'https://picsum.photos/seed/thumb1/640/360',
  'https://picsum.photos/seed/thumb2/640/360',
  'https://picsum.photos/seed/thumb3/640/360',
  'https://picsum.photos/seed/thumb4/640/360',
  'https://picsum.photos/seed/thumb5/640/360'
];

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

async function getOrCreateUsers() {
  // Try to get existing users
  let users = await User.find().limit(5);
  
  if (users.length === 0) {
    console.log('📝 No users found. Creating demo users...');
    
    const demoUsers = [
      { name: 'Alex Johnson', email: 'alex@freetalk.com', avatar: 'https://ui-avatars.com/api/?name=Alex+Johnson&background=random' },
      { name: 'Sam Rivera', email: 'sam@freetalk.com', avatar: 'https://ui-avatars.com/api/?name=Sam+Rivera&background=random' },
      { name: 'Taylor Kim', email: 'taylor@freetalk.com', avatar: 'https://ui-avatars.com/api/?name=Taylor+Kim&background=random' }
    ];
    
    for (const userData of demoUsers) {
      try {
        const user = await User.create({
          ...userData,
          password: 'Demo123456!' // Default password for demo users
        });
        users.push(user);
        console.log(`  ✅ Created user: ${userData.name}`);
      } catch (error) {
        console.log(`  ⚠️  User ${userData.email} might already exist`);
      }
    }
  }
  
  console.log(`👥 Using ${users.length} users for content creation`);
  return users;
}

async function createPosts(users, count = 20) {
  console.log(`\n📝 Creating ${count} posts...`);
  const posts = [];
  
  for (let i = 0; i < count; i++) {
    try {
      const author = users[Math.floor(Math.random() * users.length)];
      const content = POST_TEMPLATES[i % POST_TEMPLATES.length];
      const hasImage = Math.random() < 0.3; // 30% chance of image
      
      const post = await Post.create({
        content,
        author: author._id,
        images: hasImage ? [SAMPLE_IMAGES[Math.floor(Math.random() * SAMPLE_IMAGES.length)]] : [],
        mediaType: hasImage ? 'image' : 'text',
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
      });
      
      // Add random reactions
      const numReactions = Math.floor(Math.random() * 20);
      for (let j = 0; j < numReactions; j++) {
        const randomUser = users[Math.floor(Math.random() * users.length)];
        post.reactions.push({
          user: randomUser._id,
          type: ['like', 'celebrate', 'support'][Math.floor(Math.random() * 3)]
        });
      }
      await post.save();
      
      posts.push(post);
      process.stdout.write(`\r  Progress: ${i + 1}/${count} posts created`);
    } catch (error) {
      console.error(`\n  ❌ Error creating post ${i + 1}:`, error.message);
    }
  }
  
  console.log(`\n✅ Successfully created ${posts.length} posts`);
  return posts;
}

async function createVideos(users, count = 10) {
  console.log(`\n🎥 Creating ${count} videos...`);
  const videos = [];
  
  for (let i = 0; i < count; i++) {
    try {
      const author = users[Math.floor(Math.random() * users.length)];
      const videoData = VIDEO_DATA[i % VIDEO_DATA.length];
      
      const video = await Video.create({
        author: author._id,
        title: videoData.title,
        description: videoData.description,
        videoUrl: SAMPLE_VIDEOS[Math.floor(Math.random() * SAMPLE_VIDEOS.length)],
        thumbnailUrl: SAMPLE_THUMBNAILS[Math.floor(Math.random() * SAMPLE_THUMBNAILS.length)],
        duration: Math.floor(Math.random() * 300) + 30,
        visibility: 'public',
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
      });
      
      // Add random likes and views
      const numLikes = Math.floor(Math.random() * 25);
      const numViews = Math.floor(Math.random() * 100) + numLikes;
      
      for (let j = 0; j < numLikes; j++) {
        const randomUser = users[Math.floor(Math.random() * users.length)];
        video.likes.push({ user: randomUser._id });
      }
      
      for (let j = 0; j < numViews; j++) {
        const randomUser = users[Math.floor(Math.random() * users.length)];
        video.views.push({ user: randomUser._id });
      }
      
      await video.save();
      videos.push(video);
      process.stdout.write(`\r  Progress: ${i + 1}/${count} videos created`);
    } catch (error) {
      console.error(`\n  ❌ Error creating video ${i + 1}:`, error.message);
    }
  }
  
  console.log(`\n✅ Successfully created ${videos.length} videos`);
  return videos;
}

async function main() {
  console.log('🚀 FreeTalk Quick Start - Content Generator\n');
  console.log('==========================================');
  console.log('This will populate your feed with sample content!');
  console.log('No AI API keys needed - works immediately!\n');
  
  try {
    await connectDB();
    
    const users = await getOrCreateUsers();
    
    if (users.length === 0) {
      console.error('❌ Could not create or find users. Exiting...');
      process.exit(1);
    }
    
    const posts = await createPosts(users, 20);
    const videos = await createVideos(users, 10);
    
    console.log('\n==========================================');
    console.log('✅ Setup Complete!\n');
    console.log('📊 Summary:');
    console.log(`   👥 Users: ${users.length}`);
    console.log(`   📝 Posts: ${posts.length}`);
    console.log(`   🎥 Videos: ${videos.length}`);
    console.log('\n🎉 Your feed is now ready to use!');
    console.log('\n💡 Tip: For AI-generated content, check out:');
    console.log('   docs/AI_CONTENT_SETUP.md');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Done!');
    process.exit(0);
  }
}

main();
