/**
 * Script to create a new admin user
 * Usage: node scripts/createAdmin.js
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Admin details
const adminData = {
  name: 'Admin User',
  email: 'bennettjohn558@yahoo.com',
  password: 'gmpq8w9t0',
  isAdmin: true
};

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk';

mongoose.connect(mongoUri)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    console.log(`🔍 Creating admin user: ${adminData.email}\n`);

    // Check if user already exists
    const existingUser = await User.findOne({ email: adminData.email.toLowerCase() });

    if (existingUser) {
      console.log('ℹ️  User already exists!');
      
      if (existingUser.isAdmin) {
        console.log('✅ User is already an admin!');
        console.log('═══════════════════════════════════');
        console.log('👤 Name:', existingUser.name);
        console.log('📧 Email:', existingUser.email);
        console.log('👑 Admin:', existingUser.isAdmin);
        console.log('═══════════════════════════════════');
        console.log('\n🎯 You can now login to the admin panel with:');
        console.log(`   Email: ${adminData.email}`);
        console.log(`   Password: ${adminData.password}`);
      } else {
        // Make existing user admin
        existingUser.isAdmin = true;
        await existingUser.save();
        
        console.log('✅ Existing user upgraded to admin!');
        console.log('═══════════════════════════════════');
        console.log('👤 Name:', existingUser.name);
        console.log('📧 Email:', existingUser.email);
        console.log('👑 Admin:', existingUser.isAdmin);
        console.log('═══════════════════════════════════');
        console.log('\n🎯 You can now login to the admin panel with:');
        console.log(`   Email: ${adminData.email}`);
        console.log(`   Password: Your existing password`);
      }
      
      mongoose.connection.close();
      process.exit(0);
    }

    // Hash the password and PIN
    console.log('🔒 Hashing password...');
    const hashedPassword = await bcrypt.hash(adminData.password, 10);
    const hashedPin = await bcrypt.hash('1234', 10); // Default PIN
    const hashedSecurityAnswer = await bcrypt.hash('admin', 10);

    // Create new admin user
    const newAdmin = new User({
      name: adminData.name,
      email: adminData.email.toLowerCase(),
      password: hashedPassword,
      pinCode: hashedPin,
      securityQuestion: "What is your favorite movie?",
      securityAnswer: hashedSecurityAnswer,
      isAdmin: true,
      isEmailVerified: true, // Skip email verification for admin
      verificationStatus: 'manual' // Mark as manually verified
    });

    await newAdmin.save();

    console.log('\n✅ SUCCESS! Admin account created!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('👤 Name:', newAdmin.name);
    console.log('📧 Email:', newAdmin.email);
    console.log('👑 Admin:', newAdmin.isAdmin);
    console.log('🆔 User ID:', newAdmin._id);
    console.log('📅 Created:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('🎯 Login Credentials for Admin Panel:');
    console.log('   Email: bennettjohn558@yahoo.com');
    console.log('   Password: gmpq8w9t0');
    console.log('');
    console.log('🚀 Next Steps:');
    console.log('1. Open your FreeTalk Admin Desktop Panel');
    console.log('2. Login with the credentials above');
    console.log('3. Start moderating your community!');
    console.log('');

    mongoose.connection.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    mongoose.connection.close();
    process.exit(1);
  });
