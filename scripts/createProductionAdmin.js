/**
 * Script to create admin user in PRODUCTION database
 * This will connect to the production MongoDB used by freetalk.site
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  Create Admin User in PRODUCTION Database                 ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');
console.log('⚠️  WARNING: This will create an admin user in your PRODUCTION database!');
console.log('');

// Admin details
const adminData = {
  name: 'Admin User',
  email: 'bennettjohn558@yahoo.com',
  password: 'gmpq8w9t0',
  isAdmin: true
};

rl.question('Enter your PRODUCTION MongoDB URI (e.g., mongodb+srv://user:pass@cluster.mongodb.net/freetalk): ', (mongoUri) => {
  if (!mongoUri || mongoUri.trim() === '') {
    console.log('❌ No MongoDB URI provided. Exiting.');
    rl.close();
    process.exit(1);
  }

  console.log('');
  console.log('🔗 Connecting to production database...');
  
  mongoose.connect(mongoUri.trim())
    .then(async () => {
      console.log('✅ Connected to PRODUCTION MongoDB');
      console.log(`🔍 Creating admin user: ${adminData.email}\n`);

      // Check if user already exists
      const existingUser = await User.findOne({ email: adminData.email.toLowerCase() });

      if (existingUser) {
        console.log('ℹ️  User already exists in production database!');
        
        if (existingUser.isAdmin) {
          console.log('✅ User is already an admin!');
        } else {
          // Make existing user admin
          existingUser.isAdmin = true;
          await existingUser.save();
          console.log('✅ Existing user upgraded to admin!');
        }
        
        // Update password to ensure it works
        console.log('🔧 Updating password...');
        existingUser.password = adminData.password; // Will be hashed by pre-save hook
        await existingUser.save();
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ PRODUCTION Admin Account Ready!');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('👤 Name:', existingUser.name);
        console.log('📧 Email:', existingUser.email);
        console.log('👑 Admin:', existingUser.isAdmin);
        console.log('═══════════════════════════════════════════════════════════');
        
      } else {
        // Create new admin user
        console.log('🔧 Creating new admin user in production...');
        
        const newAdmin = new User({
          name: adminData.name,
          email: adminData.email.toLowerCase(),
          password: adminData.password, // Will be hashed by pre-save hook
          pinCode: '1234', // Will be hashed by pre-save hook
          securityQuestion: "What is your favorite movie?",
          securityAnswer: 'admin', // Will be hashed by pre-save hook
          isAdmin: true,
          isEmailVerified: true,
          verificationStatus: 'manual'
        });

        await newAdmin.save();

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ SUCCESS! Production Admin Account Created!');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('👤 Name:', newAdmin.name);
        console.log('📧 Email:', newAdmin.email);
        console.log('👑 Admin:', newAdmin.isAdmin);
        console.log('🆔 User ID:', newAdmin._id);
        console.log('📅 Created:', new Date().toLocaleString());
        console.log('═══════════════════════════════════════════════════════════');
      }
      
      console.log('');
      console.log('🎯 Login Credentials for Admin Panel:');
      console.log('   Email:    bennettjohn558@yahoo.com');
      console.log('   Password: gmpq8w9t0');
      console.log('');
      console.log('🚀 Your admin panel can now login to: https://freetalk.site');
      console.log('   You can monitor all users, posts, and reports in real-time!');
      console.log('');

      mongoose.connection.close();
      rl.close();
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Connection Error:', error.message);
      mongoose.connection.close();
      rl.close();
      process.exit(1);
    });
});
