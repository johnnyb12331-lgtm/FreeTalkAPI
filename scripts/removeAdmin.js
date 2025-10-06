/**
 * Script to remove admin privileges from a user
 * Usage: node scripts/removeAdmin.js your@email.com
 */

const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

// Get email from command line argument
const email = process.argv[2];

if (!email) {
  console.log('❌ Please provide an email address');
  console.log('Usage: node scripts/removeAdmin.js your@email.com');
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

    // Check if not admin
    if (!user.isAdmin) {
      console.log('ℹ️  User is not an admin!');
      console.log('👤 Name:', user.name);
      console.log('📧 Email:', user.email);
      console.log('👑 Admin:', user.isAdmin);
      mongoose.connection.close();
      process.exit(0);
    }

    // Remove admin privileges
    user.isAdmin = false;
    await user.save();

    console.log('');
    console.log('✅ SUCCESS! Admin privileges removed!');
    console.log('═══════════════════════════════════');
    console.log('👤 Name:', user.name);
    console.log('📧 Email:', user.email);
    console.log('👑 Admin:', user.isAdmin);
    console.log('📅 Updated:', new Date().toLocaleString());
    console.log('═══════════════════════════════════');
    console.log('');

    mongoose.connection.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    mongoose.connection.close();
    process.exit(1);
  });
