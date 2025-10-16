/**
 * Script to list all users (for finding an account to make admin)
 * Usage: node scripts/listUsers.js
 */

const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk';

mongoose.connect(mongoUri)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    console.log('🔍 Searching for users...\n');

    const users = await User.find({})
      .select('name email isAdmin createdAt')
      .sort({ createdAt: -1 })
      .limit(10);

    if (users.length === 0) {
      console.log('❌ No users found in database!');
      console.log('💡 Register a user through your app first, then run:');
      console.log('   node scripts/makeAdmin.js your@email.com');
      mongoose.connection.close();
      process.exit(0);
    }

    console.log(`📋 Found ${users.length} Recent User${users.length > 1 ? 's' : ''} (showing max 10):`);
    console.log('═══════════════════════════════════════════════════════════');

    users.forEach((user, index) => {
      console.log(`\n${index + 1}. ${user.name}`);
      console.log(`   📧 Email: ${user.email}`);
      console.log(`   👑 Admin: ${user.isAdmin ? 'Yes' : 'No'}`);
      console.log(`   📅 Joined: ${user.createdAt.toLocaleDateString()}`);
    });

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`\n✅ Total Users: ${users.length}\n`);
    console.log('💡 To make a user admin, run:');
    console.log('   node scripts/makeAdmin.js user@email.com\n');

    mongoose.connection.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    mongoose.connection.close();
    process.exit(1);
  });
