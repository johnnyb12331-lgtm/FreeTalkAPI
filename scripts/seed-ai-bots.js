#!/usr/bin/env node

/**
 * Seed AI Bots
 * Creates AI bot users in the database with profile images
 *
 * Usage: node scripts/seed-ai-bots.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// AI Bot configurations
const AI_BOTS = [
  {
    name: 'AI Assistant',
    email: 'ai.assistant@freetalk.bot',
    bio: 'Your helpful AI assistant for chatting and answering questions!',
    avatar: '/api/uploads/bot_avatars/ai_assistant.svg',
    isBot: true
  },
  {
    name: 'Chat Bot',
    email: 'chat.bot@freetalk.bot',
    bio: 'A friendly chatbot ready to have conversations with you!',
    avatar: '/api/uploads/bot_avatars/chat_bot.svg',
    isBot: true
  },
  {
    name: 'Helper Bot',
    email: 'helper.bot@freetalk.bot',
    bio: 'Here to help with tips, advice, and general assistance!',
    avatar: '/api/uploads/bot_avatars/helper_bot.svg',
    isBot: true
  }
];

async function seedAIBots() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('🌱 Seeding AI Bots...');

    for (const botData of AI_BOTS) {
      // Check if bot already exists
      const existingBot = await User.findOne({ email: botData.email });

      if (existingBot) {
        console.log(`🤖 ${botData.name} already exists, updating...`);
        await User.findByIdAndUpdate(existingBot._id, {
          ...botData,
          // Generate a random password hash for bots (they won't login normally)
          password: await bcrypt.hash(Math.random().toString(36), 12)
        });
      } else {
        console.log(`🤖 Creating ${botData.name}...`);
        const bot = new User({
          ...botData,
          password: await bcrypt.hash(Math.random().toString(36), 12), // Random password
          emailVerified: true, // Bots don't need email verification
          isOnline: true, // Bots are always "online"
        });
        await bot.save();
      }
    }

    console.log('✅ AI Bots seeded successfully!');
    console.log('🤖 Available AI Bots:');
    AI_BOTS.forEach(bot => console.log(`   - ${bot.name}: ${bot.email}`));

  } catch (error) {
    console.error('❌ Error seeding AI bots:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed.');
  }
}

// Run the seeder
seedAIBots();