/**
 * Script to grant premium status with verified badge to a user for testing
 * Usage: node scripts/makePremium.js <email_or_userId>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function makePremium() {
  try {
    // Get email or user ID from command line
    const identifier = process.argv[2];
    
    if (!identifier) {
      console.error('❌ Error: Please provide an email or user ID');
      console.log('Usage: node scripts/makePremium.js <email_or_userId>');
      process.exit(1);
    }

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📦 Connected to MongoDB');

    // Find user by email or ID
    const query = identifier.includes('@') 
      ? { email: identifier }
      : { _id: identifier };
    
    const user = await User.findOne(query);

    if (!user) {
      console.error(`❌ User not found: ${identifier}`);
      process.exit(1);
    }

    // Set premium status with verified badge
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    user.isPremium = true;
    user.premiumFeatures = [
      'profile_visitors',
      'ad_free', 
      'custom_themes',
      'unlimited_storage',
      'verified_badge'
    ];
    user.premiumPurchaseDate = new Date();
    user.premiumExpiresAt = oneYearFromNow;

    await user.save();

    console.log('\n✅ User granted premium status with verified badge!');
    console.log('👤 Name:', user.name);
    console.log('📧 Email:', user.email);
    console.log('🆔 ID:', user._id);
    console.log('💎 Premium:', user.isPremium);
    console.log('🎖️ Features:', user.premiumFeatures.join(', '));
    console.log('📅 Expires:', user.premiumExpiresAt.toLocaleDateString());
    console.log('\n🎉 The verified badge should now appear in the app!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

makePremium();
