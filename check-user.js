require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function checkUser() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    const user = await User.findOne({email: 'dfd@yahoo.com'}).select('+password');
    
    if (!user) {
      console.log('❌ User not found');
      await mongoose.connection.close();
      process.exit(1);
    }
    
    console.log('✅ User found:', user.email);
    console.log('Has password field:', !!user.password);
    console.log('Password is hashed (starts with $2):', user.password ? user.password.startsWith('$2') : false);
    console.log('Password length:', user.password ? user.password.length : 0);
    
    // Try to compare with a test password
    const testPasswords = ['Test1234', 'test1234', 'Password123', 'password'];
    for (const pwd of testPasswords) {
      try {
        const isValid = await user.comparePassword(pwd);
        if (isValid) {
          console.log(`✅ Password "${pwd}" matches!`);
        } else {
          console.log(`❌ Password "${pwd}" does not match`);
        }
      } catch (err) {
        console.log(`❌ Error testing password "${pwd}":`, err.message);
      }
    }
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkUser();
