/**
 * Script to check user credentials and fix password
 * Usage: node scripts/checkAndFixAdmin.js
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const email = 'bennettjohn558@yahoo.com';
const newPassword = 'gmpq8w9t0';

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk';

mongoose.connect(mongoUri)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    console.log(`🔍 Checking user: ${email}\n`);

    // Find user with password field
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user) {
      console.log('❌ User not found!');
      mongoose.connection.close();
      process.exit(1);
    }

    console.log('📋 User Found:');
    console.log('═══════════════════════════════════');
    console.log('👤 Name:', user.name);
    console.log('📧 Email:', user.email);
    console.log('👑 Admin:', user.isAdmin);
    console.log('🔒 Has Password:', user.password ? 'Yes' : 'No');
    console.log('');

    // Check if password exists
    if (!user.password) {
      console.log('⚠️  User has no password set!');
      console.log('🔧 Setting password now...');
      
      // Set password as plain text - the pre-save hook will hash it
      user.password = newPassword;
      await user.save();
      
      console.log('✅ Password set successfully!');
    } else {
      console.log('🔧 Updating password to ensure it works...');
      
      // Set password as plain text - the pre-save hook will hash it
      user.password = newPassword;
      await user.save();
      
      console.log('✅ Password updated successfully!');
    }

    // Verify the password works
    const updatedUser = await User.findOne({ email: email.toLowerCase() }).select('+password');
    const passwordMatch = await bcrypt.compare(newPassword, updatedUser.password);
    
    console.log('');
    console.log('🧪 Testing password...');
    console.log('Password Test:', passwordMatch ? '✅ PASS' : '❌ FAIL');
    console.log('');

    if (passwordMatch) {
      console.log('═══════════════════════════════════════════════════════════');
      console.log('✅ READY TO LOGIN!');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
      console.log('🔐 Login Credentials:');
      console.log(`   Email:    ${email}`);
      console.log(`   Password: ${newPassword}`);
      console.log('');
      console.log('🚀 Try logging in again to your admin panel!');
      console.log('');
    } else {
      console.log('❌ Password verification failed! Something is wrong.');
    }

    mongoose.connection.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    mongoose.connection.close();
    process.exit(1);
  });
