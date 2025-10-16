/**
 * Script to delete all clubs from the database
 * Use with caution - this will permanently delete all club data
 */

const mongoose = require('mongoose');
const Club = require('../models/Club');
require('dotenv').config();

async function deleteAllClubs() {
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
    
    // Get current count
    const clubCount = await Club.countDocuments();
    console.log(`📊 Found ${clubCount} clubs in the database`);
    
    if (clubCount === 0) {
      console.log('✅ No clubs to delete');
      await mongoose.connection.close();
      process.exit(0);
    }

    // Ask for confirmation (in production, you might want to require a CLI argument)
    console.log('⚠️  WARNING: This will DELETE ALL CLUBS permanently!');
    console.log('⚠️  This action CANNOT be undone!');
    
    // Delete all clubs
    console.log('🗑️  Deleting all clubs...');
    const result = await Club.deleteMany({});
    
    console.log(`✅ Successfully deleted ${result.deletedCount} clubs`);
    
    // Verify deletion
    const remainingCount = await Club.countDocuments();
    console.log(`📊 Remaining clubs: ${remainingCount}`);
    
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error deleting clubs:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Run the script
deleteAllClubs();
