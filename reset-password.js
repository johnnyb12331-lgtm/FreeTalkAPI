require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function resetPassword() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');
    
    rl.question('Enter email: ', async (email) => {
      rl.question('Enter new password: ', async (password) => {
        const user = await User.findOne({ email: email.toLowerCase() });
        
        if (!user) {
          console.log('❌ User not found');
          await mongoose.connection.close();
          rl.close();
          process.exit(1);
        }
        
        user.password = password;
        await user.save();
        
        console.log(`✅ Password updated for ${user.email}`);
        console.log('You can now login with the new password');
        
        await mongoose.connection.close();
        rl.close();
        process.exit(0);
      });
    });
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

resetPassword();
