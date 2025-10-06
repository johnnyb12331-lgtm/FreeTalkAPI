/**
 * Script to list all admin users
 * Usage: node scripts/listAdmins.js
 */

const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk';

mongoose.connect(mongoUri)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    console.log('🔍 Searching for admin users...\n');

    const admins = await User.find({ isAdmin: true })
      .select('name email isAdmin createdAt')
      .sort({ createdAt: -1 });

    if (admins.length === 0) {
      console.log('❌ No admin users found!');
      console.log('💡 Use "node scripts/makeAdmin.js your@email.com" to create one');
      mongoose.connection.close();
      process.exit(0);
    }

    console.log(`👑 Found ${admins.length} Admin User${admins.length > 1 ? 's' : ''}:`);
    console.log('═══════════════════════════════════════════════════════════');

    admins.forEach((admin, index) => {
      console.log(`\n${index + 1}. ${admin.name}`);
      console.log(`   📧 Email: ${admin.email}`);
      console.log(`   🆔 ID: ${admin._id}`);
      console.log(`   📅 Joined: ${admin.createdAt.toLocaleDateString()}`);
    });

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`\n✅ Total Admin Users: ${admins.length}\n`);

    mongoose.connection.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    mongoose.connection.close();
    process.exit(1);
  });
