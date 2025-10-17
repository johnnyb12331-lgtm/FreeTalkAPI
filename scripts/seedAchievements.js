/**
 * Script to seed predefined achievements into the database
 * Run this script once to initialize the achievement system
 * 
 * Usage: node scripts/seedAchievements.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { Achievement, PREDEFINED_ACHIEVEMENTS } = require('../models/Achievement');

async function seedAchievements() {
  try {
    console.log('🌱 Starting achievement seeding...\n');

    // Connect to database
    await connectDB();
    console.log('✅ Connected to database\n');

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    for (const achievementData of PREDEFINED_ACHIEVEMENTS) {
      try {
        console.log(`Processing: ${achievementData.name} (${achievementData.key})...`);

        const existing = await Achievement.findOne({ key: achievementData.key });

        if (existing) {
          // Update existing achievement
          await Achievement.findByIdAndUpdate(existing._id, achievementData);
          console.log(`  ✅ Updated existing achievement`);
          results.updated++;
        } else {
          // Create new achievement
          await Achievement.create(achievementData);
          console.log(`  ✅ Created new achievement`);
          results.created++;
        }
      } catch (err) {
        console.error(`  ❌ Error processing ${achievementData.key}:`, err.message);
        results.errors.push({
          key: achievementData.key,
          error: err.message
        });
      }
    }

    console.log('\n========================================');
    console.log('📊 SEEDING RESULTS');
    console.log('========================================');
    console.log(`✅ Created: ${results.created}`);
    console.log(`🔄 Updated: ${results.updated}`);
    console.log(`⏭️  Skipped: ${results.skipped}`);
    console.log(`❌ Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      console.log('\n❌ Error Details:');
      results.errors.forEach(err => {
        console.log(`  - ${err.key}: ${err.error}`);
      });
    }

    console.log('========================================\n');

    // Display summary by category
    const achievements = await Achievement.find({ isActive: true });
    const byCategory = {};
    achievements.forEach(a => {
      byCategory[a.category] = (byCategory[a.category] || 0) + 1;
    });

    console.log('📈 Achievement Summary by Category:');
    Object.entries(byCategory).forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });

    console.log(`\n🎉 Total Active Achievements: ${achievements.length}\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error during seeding:', error);
    process.exit(1);
  }
}

// Run the seeding function
seedAchievements();
