/**
 * Migration Script: Clean up old "free verification" users
 * 
 * This script finds users who received free verification before the change
 * (when free verification also granted premium status) and separates their statuses.
 * 
 * Usage: node scripts/migrate-verified-users.js [--dry-run]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function migrateVerifiedUsers(dryRun = false) {
  try {
    console.log('🔄 Starting migration of verified users...\n');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📦 Connected to MongoDB\n');

    // Find users who got free verification (had only verified_badge in premium features)
    const usersToMigrate = await User.find({
      isPremium: true,
      premiumFeatures: { $size: 1 },
      premiumFeatures: 'verified_badge'
    });

    console.log(`Found ${usersToMigrate.length} users to migrate\n`);

    if (usersToMigrate.length === 0) {
      console.log('✅ No users need migration!');
      process.exit(0);
    }

    let migrated = 0;
    let errors = 0;

    for (const user of usersToMigrate) {
      try {
        console.log(`Migrating user: ${user.name} (${user.email})`);
        
        if (!dryRun) {
          // Keep verification but remove premium
          user.isVerified = true;
          user.verifiedAt = user.premiumPurchaseDate || user.createdAt;
          user.verificationMethod = 'free';
          
          // Remove premium status
          user.isPremium = false;
          user.premiumTier = null;
          user.premiumFeatures = [];
          user.premiumExpiresAt = null;
          user.premiumPurchaseDate = null;
          
          await user.save();
          console.log('  ✅ Migrated successfully\n');
        } else {
          console.log('  🔍 [DRY RUN] Would migrate this user\n');
        }
        
        migrated++;
      } catch (error) {
        console.error(`  ❌ Error migrating user ${user.email}:`, error.message);
        errors++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log('─────────────────────────────────');
    console.log(`Total users found:     ${usersToMigrate.length}`);
    console.log(`Successfully migrated: ${migrated}`);
    console.log(`Errors:                ${errors}`);
    
    if (dryRun) {
      console.log('\n⚠️  This was a DRY RUN - no changes were made');
      console.log('Run without --dry-run flag to apply changes');
    } else {
      console.log('\n✅ Migration complete!');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Check for dry-run flag
const dryRun = process.argv.includes('--dry-run');

if (dryRun) {
  console.log('🔍 Running in DRY RUN mode - no changes will be made\n');
}

migrateVerifiedUsers(dryRun);
