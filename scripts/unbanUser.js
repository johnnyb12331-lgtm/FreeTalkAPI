const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const unbanUser = async (email) => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    console.log(`🔍 Looking for user: ${email}\n`);
    
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.log('❌ User not found');
      mongoose.connection.close();
      process.exit(1);
    }
    
    if (!user.isBanned && !user.isSuspended) {
      console.log('⚠️  User is not banned or suspended');
      console.log(`   Name: ${user.name}`);
      console.log(`   Email: ${user.email}`);
      mongoose.connection.close();
      process.exit(0);
    }
    
    // Unban and unsuspend the user
    const wasBanned = user.isBanned;
    const wasSuspended = user.isSuspended;
    
    user.isBanned = false;
    user.bannedAt = null;
    user.isSuspended = false;
    user.suspensionReason = null;
    user.suspendedAt = null;
    user.suspendedBy = null;
    
    await user.save();
    
    console.log('✅ SUCCESS! User has been restored!');
    console.log('═══════════════════════════════════');
    console.log(`👤 Name: ${user.name}`);
    console.log(`📧 Email: ${user.email}`);
    if (wasBanned) console.log('🔓 Status: UNBANNED');
    if (wasSuspended) console.log('🔓 Status: UNSUSPENDED');
    console.log(`📅 Updated: ${new Date().toLocaleString()}`);
    console.log('═══════════════════════════════════\n');
    
    console.log('🎯 The user can now:');
    console.log('   • Log in to their account');
    console.log('   • Access all features');
    console.log('   • Post and interact normally');
    console.log('');
    
    mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    mongoose.connection.close();
    process.exit(1);
  }
};

const email = process.argv[2];

if (!email) {
  console.log('Usage: node unbanUser.js <email>');
  console.log('Example: node unbanUser.js user@example.com');
  process.exit(1);
}

unbanUser(email);
