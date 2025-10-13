#!/usr/bin/env node

/**
 * AI Content Seeder
 * Automatically generates posts and videos using AI to populate the feed
 * 
 * Usage:
 *   node scripts/seed-ai-content.js --posts 20 --videos 10
 * 
 * Options:
 *   --posts [number]   Number of posts to generate (default: 10)
 *   --videos [number]  Number of videos to generate (default: 5)
 *   --users [ids]      Comma-separated user IDs to use as authors (optional)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Video = require('../models/Video');
const aiGenerator = require('../services/aiContentGenerator');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (flag, defaultValue) => {
  const index = args.indexOf(flag);
  return index > -1 && args[index + 1] ? args[index + 1] : defaultValue;
};

const NUM_POSTS = parseInt(getArg('--posts', '10'));
const NUM_VIDEOS = parseInt(getArg('--videos', '5'));
const USER_IDS = getArg('--users', null);

// Sample video URLs (placeholder - you can replace with actual video URLs)
const SAMPLE_VIDEO_URLS = [
  'https://example.com/videos/sample1.mp4',
  'https://example.com/videos/sample2.mp4',
  'https://example.com/videos/sample3.mp4',
  'https://example.com/videos/sample4.mp4',
  'https://example.com/videos/sample5.mp4'
];

// Sample thumbnail URLs
const SAMPLE_THUMBNAIL_URLS = [
  'https://picsum.photos/seed/video1/640/360',
  'https://picsum.photos/seed/video2/640/360',
  'https://picsum.photos/seed/video3/640/360',
  'https://picsum.photos/seed/video4/640/360',
  'https://picsum.photos/seed/video5/640/360'
];

// Sample image URLs for posts
const SAMPLE_IMAGE_URLS = [
  'https://picsum.photos/seed/post1/800/600',
  'https://picsum.photos/seed/post2/800/600',
  'https://picsum.photos/seed/post3/800/600',
  'https://picsum.photos/seed/post4/800/600',
  'https://picsum.photos/seed/post5/800/600'
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

async function getRandomUsers(count = 5) {
  try {
    let users;
    
    if (USER_IDS) {
      // Use specified user IDs
      const ids = USER_IDS.split(',').map(id => id.trim());
      users = await User.find({ _id: { $in: ids } });
      console.log(`📌 Using ${users.length} specified users`);
    } else {
      // Get random users from database
      users = await User.aggregate([{ $sample: { size: count } }]);
      console.log(`🎲 Selected ${users.length} random users`);
    }

    if (users.length === 0) {
      console.log('⚠️  No users found. Creating a demo user...');
      const demoUser = await User.create({
        name: 'AI Content Creator',
        email: `ai-creator-${Date.now()}@freetalk.com`,
        password: 'demo123456',
        avatar: 'https://ui-avatars.com/api/?name=AI+Creator&background=random'
      });
      users = [demoUser];
    }

    return users;
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    throw error;
  }
}

async function generatePosts(users) {
  console.log(`\n📝 Generating ${NUM_POSTS} AI posts...`);
  const posts = [];

  for (let i = 0; i < NUM_POSTS; i++) {
    try {
      const author = users[Math.floor(Math.random() * users.length)];
      
      // Generate post content using AI
      console.log(`  [${i + 1}/${NUM_POSTS}] Generating post for ${author.name}...`);
      const content = await aiGenerator.generatePost();
      
      // Randomly decide if post should have an image (40% chance)
      const hasImage = Math.random() < 0.4;
      const images = hasImage ? [SAMPLE_IMAGE_URLS[Math.floor(Math.random() * SAMPLE_IMAGE_URLS.length)]] : [];
      
      const post = await Post.create({
        content,
        author: author._id,
        images,
        mediaType: images.length > 0 ? 'image' : 'text',
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000) // Random time in last 7 days
      });

      posts.push(post);
      console.log(`  ✅ Created: "${content.substring(0, 50)}..."`);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`  ❌ Error creating post ${i + 1}:`, error.message);
    }
  }

  console.log(`\n✅ Successfully created ${posts.length} posts`);
  return posts;
}

async function generateVideos(users) {
  console.log(`\n🎥 Generating ${NUM_VIDEOS} AI videos...`);
  const videos = [];

  for (let i = 0; i < NUM_VIDEOS; i++) {
    try {
      const author = users[Math.floor(Math.random() * users.length)];
      
      // Generate video content using AI
      console.log(`  [${i + 1}/${NUM_VIDEOS}] Generating video for ${author.name}...`);
      const videoContent = await aiGenerator.generateVideoContent();
      
      const video = await Video.create({
        author: author._id,
        title: videoContent.title,
        description: videoContent.description,
        videoUrl: SAMPLE_VIDEO_URLS[Math.floor(Math.random() * SAMPLE_VIDEO_URLS.length)],
        thumbnailUrl: SAMPLE_THUMBNAIL_URLS[Math.floor(Math.random() * SAMPLE_THUMBNAIL_URLS.length)],
        duration: Math.floor(Math.random() * 300) + 30, // 30-330 seconds
        visibility: 'public',
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000) // Random time in last 7 days
      });

      videos.push(video);
      console.log(`  ✅ Created: "${videoContent.title}"`);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`  ❌ Error creating video ${i + 1}:`, error.message);
    }
  }

  console.log(`\n✅ Successfully created ${videos.length} videos`);
  return videos;
}

async function addRandomEngagement(posts, videos, users) {
  console.log('\n👍 Adding random engagement (likes, comments, views)...');
  
  // Add likes and comments to posts
  for (const post of posts) {
    try {
      const numLikes = Math.floor(Math.random() * 15);
      const likeUsers = users.sort(() => 0.5 - Math.random()).slice(0, numLikes);
      
      for (const user of likeUsers) {
        post.reactions.push({
          user: user._id,
          type: ['like', 'celebrate', 'support'][Math.floor(Math.random() * 3)]
        });
      }
      
      await post.save();
    } catch (error) {
      console.error(`  ❌ Error adding engagement to post:`, error.message);
    }
  }

  // Add likes, views, and comments to videos
  for (const video of videos) {
    try {
      const numLikes = Math.floor(Math.random() * 20);
      const numViews = Math.floor(Math.random() * 100) + numLikes;
      
      const likeUsers = users.sort(() => 0.5 - Math.random()).slice(0, numLikes);
      const viewUsers = users.sort(() => 0.5 - Math.random()).slice(0, numViews);
      
      for (const user of likeUsers) {
        video.likes.push({ user: user._id });
      }
      
      for (const user of viewUsers) {
        video.views.push({ user: user._id });
      }
      
      await video.save();
    } catch (error) {
      console.error(`  ❌ Error adding engagement to video:`, error.message);
    }
  }

  console.log('✅ Engagement added successfully');
}

async function main() {
  console.log('🤖 AI Content Seeder for FreeTalk\n');
  console.log('================================');
  
  // Check AI configuration
  const aiStatus = aiGenerator.getStatus();
  console.log(`\n🔧 AI Configuration:`);
  console.log(`   Active Provider: ${aiStatus.activeProvider || 'None (using fallback)'}`);
  aiStatus.providers.forEach(p => {
    console.log(`   ${p.name}: ${p.configured ? '✅ Configured' : '❌ Not configured'}`);
  });
  
  if (!aiStatus.configured) {
    console.log('\n⚠️  No AI provider configured. Content will be generated using fallback templates.');
    console.log('💡 To use AI, add API keys to your .env file:');
    console.log('   HUGGINGFACE_API_KEY=your_key (FREE at huggingface.co)');
    console.log('   GROQ_API_KEY=your_key (FREE at groq.com)');
    console.log('   GEMINI_API_KEY=your_key (FREE at ai.google.dev)');
    console.log('   OPENAI_API_KEY=your_key ($5 free trial)\n');
  }

  try {
    // Connect to database
    await connectDB();

    // Get users to use as authors
    const users = await getRandomUsers();

    // Generate content
    const posts = await generatePosts(users);
    const videos = await generateVideos(users);

    // Add engagement
    await addRandomEngagement(posts, videos, users);

    console.log('\n================================');
    console.log('✅ AI Content Generation Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`   Posts created: ${posts.length}`);
    console.log(`   Videos created: ${videos.length}`);
    console.log(`   Users involved: ${users.length}`);
    console.log('\n🎉 Your feed is now populated with AI-generated content!');

  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Database connection closed');
    process.exit(0);
  }
}

// Run the seeder
main();
