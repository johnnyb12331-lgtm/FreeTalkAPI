/**
 * Script to grant admin privileges to a user
 * Usage: node scripts/makeAdmin.js your@email.com
 */

const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

// Get email from command line argument
const email = process.argv[2];

if (!email) {
  console.log('❌ Please provide an email address');
  console.log('Usage: node scripts/makeAdmin.js your@email.com');
  process.exit(1);
}

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk';

mongoose.connect(mongoUri)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    console.log(`🔍 Looking for user: ${email}`);

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      console.log('❌ User not found with email:', email);
      console.log('💡 Make sure the email is correct and the user exists');
      mongoose.connection.close();
      process.exit(1);
    }

    // Check if already admin
    if (user.isAdmin) {
      console.log('ℹ️  User is already an admin!');
      console.log('👤 Name:', user.name);
      console.log('📧 Email:', user.email);
      console.log('👑 Admin:', user.isAdmin);
      mongoose.connection.close();
      process.exit(0);
    }

    // Update user to admin
    user.isAdmin = true;
    await user.save();

    console.log('');
    console.log('✅ SUCCESS! Admin privileges granted!');
    console.log('═══════════════════════════════════');
    console.log('👤 Name:', user.name);
    console.log('📧 Email:', user.email);
    console.log('👑 Admin:', user.isAdmin);
    console.log('📅 Updated:', new Date().toLocaleString());
    console.log('═══════════════════════════════════');
    console.log('');
    console.log('🎯 Next Steps:');
    console.log('1. Restart your Flutter app');
    console.log('2. Go to Profile → Profile Settings');
    console.log('3. You should now see "Admin Reports" option');
    console.log('');

    mongoose.connection.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    mongoose.connection.close();
    process.exit(1);
  });
