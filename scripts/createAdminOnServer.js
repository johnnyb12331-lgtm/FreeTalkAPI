/**
 * Create Admin User - Run this ON the production server
 * Place in /root/FreeTalkAPI/scripts/ and run with: node scripts/createAdminOnServer.js
 */

const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const adminData = {
  name: 'Admin User',
  email: 'bennettjohn558@yahoo.com',
  password: 'gmpq8w9t0',
  isAdmin: true
};

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  Creating Admin User on Production Server                 ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

async function createAdmin() {
  try {
    // Connect using the MONGODB_URI from .env file
    console.log('🔗 Connecting to MongoDB from .env...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to production database\n');

    // Check if user exists
    let admin = await User.findOne({ email: adminData.email.toLowerCase() });

    if (admin) {
      console.log('ℹ️  User already exists!');
      
      // Update to admin
      admin.isAdmin = true;
      admin.password = adminData.password; // Will be hashed by pre-save hook
      await admin.save();
      
      console.log('✅ User updated to admin status!\n');
    } else {
      console.log('🔧 Creating new admin user...');
      
      admin = new User({
        name: adminData.name,
        email: adminData.email.toLowerCase(),
        password: adminData.password,
        pinCode: '1234',
        securityQuestion: "What is your favorite movie?",
        securityAnswer: 'admin',
        isAdmin: true,
        isEmailVerified: true,
        verificationStatus: 'manual'
      });

      await admin.save();
      console.log('✅ New admin user created!\n');
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ SUCCESS! Admin Account Ready!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('👤 Name:', admin.name);
    console.log('📧 Email:', admin.email);
    console.log('👑 Admin:', admin.isAdmin);
    console.log('🆔 User ID:', admin._id);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('✅ You can now login with these credentials!');
    console.log('');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

createAdmin();
