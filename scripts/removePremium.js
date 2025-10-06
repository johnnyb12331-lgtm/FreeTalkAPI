/**
 * Script to remove premium status from a user
 * Usage: node scripts/removePremium.js <email_or_userId>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function removePremium() {
  try {
    // Get email or user ID from command line
    const identifier = process.argv[2];
    
    if (!identifier) {
      console.error('❌ Error: Please provide an email or user ID');
      console.log('Usage: node scripts/removePremium.js <email_or_userId>');
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

    // Remove premium status
    user.isPremium = false;
    user.premiumFeatures = [];
    user.premiumPurchaseDate = null;
    user.premiumExpiresAt = null;

    await user.save();

    console.log('\n✅ Premium status removed!');
    console.log('👤 Name:', user.name);
    console.log('📧 Email:', user.email);
    console.log('🆔 ID:', user._id);
    console.log('💎 Premium:', user.isPremium);
    console.log('🎖️ Features:', user.premiumFeatures.length > 0 ? user.premiumFeatures.join(', ') : 'None');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

removePremium();
