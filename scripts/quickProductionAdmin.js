/**
 * Quick Production Admin Creator
 * Creates admin in production database: mongodb://localhost:27017/freetalk
 */

const mongoose = require('mongoose');
const User = require('../models/User');

// Production MongoDB URI from your server
const PRODUCTION_MONGODB_URI = 'mongodb://localhost:27017/freetalk';

const adminData = {
  name: 'Admin User',
  email: 'bennettjohn558@yahoo.com',
  password: 'gmpq8w9t0',
  isAdmin: true
};

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  Creating Admin in PRODUCTION Database                    ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

async function createProductionAdmin() {
  try {
    console.log('🔗 Connecting to production database...');
    console.log('   URI: mongodb://localhost:27017/freetalk\n');
    
    await mongoose.connect(PRODUCTION_MONGODB_URI);
    console.log('✅ Connected to PRODUCTION MongoDB\n');

    // Check if user exists
    let admin = await User.findOne({ email: adminData.email.toLowerCase() });

    if (admin) {
      console.log('ℹ️  User already exists in production database!');
      
      // Update to admin
      admin.isAdmin = true;
      admin.password = adminData.password; // Will be hashed by pre-save hook
      await admin.save();
      
      console.log('✅ User updated and set as admin!\n');
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
    console.log('✅ SUCCESS! Production Admin Ready!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('👤 Name:', admin.name);
    console.log('📧 Email:', admin.email);
    console.log('👑 Admin:', admin.isAdmin);
    console.log('🆔 User ID:', admin._id);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('🎯 Login to your desktop admin panel with:');
    console.log('   Email:    bennettjohn558@yahoo.com');
    console.log('   Password: gmpq8w9t0');
    console.log('');
    console.log('🚀 You can now monitor https://freetalk.site in real-time!');
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

createProductionAdmin();
