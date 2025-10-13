/**
 * Script to fix malformed avatar URLs in the database
 * Fixes patterns like:
 * - https//example.com -> https://example.com
 * - https://freetalk.sitehttps//example.com -> https://example.com
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk';

// Function to fix malformed URL
function fixMalformedUrl(url) {
  if (!url || typeof url !== 'string') {
    return url;
  }

  let fixed = url.trim();
  
  // Pattern 1: Remove base URL prefix from external URLs
  // https://freetalk.sitehttps//example.com -> https://example.com
  // https://freetalk.sitehttps://example.com -> https://example.com
  const baseUrlPattern = /https?:\/\/[^/]+\/?(https?[:/]+.*)$/;
  const baseUrlMatch = baseUrlPattern.exec(fixed);
  if (baseUrlMatch) {
    fixed = baseUrlMatch[1];
  }
  
  // Pattern 2: Fix missing colon in protocol
  // https//example.com -> https://example.com
  if (fixed.startsWith('https//')) {
    fixed = fixed.replace(/^https\/\//, 'https://');
  } else if (fixed.startsWith('http//')) {
    fixed = fixed.replace(/^http\/\//, 'http://');
  }
  
  // Pattern 3: Fix any remaining malformed protocols in middle of string
  if (fixed.includes('https//') || fixed.includes('http//')) {
    const malformedMatch = /(https?\/\/[^\s]+)/.exec(fixed);
    if (malformedMatch) {
      fixed = malformedMatch[1];
      fixed = fixed.replace(/^https\/\//, 'https://').replace(/^http\/\//, 'http://');
    }
  }
  
  return fixed;
}

async function fixMalformedAvatarUrls() {
  try {
    console.log('🔧 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all users with avatars
    console.log('🔍 Finding users with avatars...');
    const users = await User.find({ 
      avatar: { $exists: true, $ne: null, $ne: '' } 
    });
    
    console.log(`📊 Found ${users.length} users with avatars\n`);
    
    let fixedCount = 0;
    let skippedCount = 0;
    const fixes = [];

    for (const user of users) {
      const originalAvatar = user.avatar;
      const fixedAvatar = fixMalformedUrl(originalAvatar);
      
      if (originalAvatar !== fixedAvatar) {
        console.log(`🔧 Fixing avatar for user: ${user.name} (${user.email})`);
        console.log(`   Original: ${originalAvatar}`);
        console.log(`   Fixed:    ${fixedAvatar}\n`);
        
        user.avatar = fixedAvatar;
        await user.save();
        
        fixes.push({
          userId: user._id,
          name: user.name,
          email: user.email,
          original: originalAvatar,
          fixed: fixedAvatar
        });
        
        fixedCount++;
      } else {
        skippedCount++;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   ✅ Fixed: ${fixedCount} avatars`);
    console.log(`   ⏭️  Skipped (already valid): ${skippedCount} avatars`);
    console.log(`   📝 Total processed: ${users.length} users\n`);

    if (fixes.length > 0) {
      console.log('📋 Detailed fixes:');
      fixes.forEach((fix, index) => {
        console.log(`\n${index + 1}. ${fix.name} (${fix.email})`);
        console.log(`   User ID: ${fix.userId}`);
        console.log(`   Before:  ${fix.original}`);
        console.log(`   After:   ${fix.fixed}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

// Run the script
fixMalformedAvatarUrls()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
