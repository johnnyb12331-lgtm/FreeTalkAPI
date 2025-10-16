/**
 * Script to check for duplicate club memberships
 * This will help identify if a user appears multiple times in the members array
 */

const mongoose = require('mongoose');
const Club = require('../models/Club');
require('dotenv').config();

async function checkDuplicateClubMemberships() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log('✅ Connected to MongoDB');
    
    // Get all clubs
    const clubs = await Club.find({}).populate('members.user', 'name email');
    console.log(`📊 Found ${clubs.length} clubs in the database`);
    
    let duplicatesFound = 0;
    let totalMembershipIssues = 0;

    for (const club of clubs) {
      const memberUserIds = club.members.map(m => m.user?._id?.toString()).filter(Boolean);
      const uniqueMemberIds = new Set(memberUserIds);
      
      if (memberUserIds.length !== uniqueMemberIds.size) {
        duplicatesFound++;
        console.log('\n⚠️  DUPLICATE MEMBERSHIP FOUND:');
        console.log(`   Club: ${club.name} (${club._id})`);
        console.log(`   Total members: ${memberUserIds.length}`);
        console.log(`   Unique members: ${uniqueMemberIds.size}`);
        
        // Find which users are duplicated
        const userIdCounts = {};
        memberUserIds.forEach(id => {
          userIdCounts[id] = (userIdCounts[id] || 0) + 1;
        });
        
        Object.entries(userIdCounts).forEach(([userId, count]) => {
          if (count > 1) {
            const member = club.members.find(m => m.user?._id?.toString() === userId);
            console.log(`   👤 Duplicated User: ${member?.user?.name || userId} appears ${count} times`);
            totalMembershipIssues += (count - 1); // Count extra memberships
          }
        });
      }
    }
    
    console.log('\n========================================');
    console.log('📊 SUMMARY:');
    console.log(`   Total clubs: ${clubs.length}`);
    console.log(`   Clubs with duplicate memberships: ${duplicatesFound}`);
    console.log(`   Total extra memberships: ${totalMembershipIssues}`);
    
    if (duplicatesFound > 0) {
      console.log('\n⚠️  Duplicates found! You should fix these by removing duplicate entries.');
      console.log('   Run the fix-duplicate-clubs.js script to clean them up.');
    } else {
      console.log('\n✅ No duplicate memberships found!');
    }
    
    console.log('========================================\n');
    
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking clubs:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Run the script
checkDuplicateClubMemberships();
