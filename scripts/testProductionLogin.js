/**
 * Test Production Login and Check Admin Status
 */

const axios = require('axios');

const API_URL = 'https://freetalk.site/api';
const credentials = {
  email: 'bennettjohn558@yahoo.com',
  password: 'gmpq8w9t0'
};

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  Testing Production API Login                             ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('🔗 API URL:', API_URL);
console.log('📧 Email:', credentials.email);
console.log('🔑 Password:', credentials.password);
console.log('');

async function testLogin() {
  try {
    console.log('📤 Sending login request to:', `${API_URL}/auth/login`);
    console.log('');

    const response = await axios.post(`${API_URL}/auth/login`, credentials, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    console.log('✅ Login Successful!');
    console.log('');
    console.log('Response Status:', response.status);
    console.log('Response Data:', JSON.stringify(response.data, null, 2));
    console.log('');

    if (response.data.user) {
      console.log('═══════════════════════════════════════════════════════════');
      console.log('👤 User Info:');
      console.log('   Name:', response.data.user.name);
      console.log('   Email:', response.data.user.email);
      console.log('   Admin:', response.data.user.isAdmin);
      console.log('   User ID:', response.data.user._id);
      console.log('═══════════════════════════════════════════════════════════');
    }

    if (response.data.accessToken) {
      console.log('🎫 Access Token:', response.data.accessToken.substring(0, 50) + '...');
    }

  } catch (error) {
    console.log('❌ Login Failed!');
    console.log('');
    
    if (error.response) {
      console.log('Response Status:', error.response.status);
      console.log('Response Data:', JSON.stringify(error.response.data, null, 2));
      console.log('');
      
      if (error.response.status === 401) {
        console.log('⚠️  Issue: Invalid credentials on production server');
        console.log('');
        console.log('Possible causes:');
        console.log('1. Admin user exists in LOCAL database but not PRODUCTION database');
        console.log('2. Password mismatch between what we set and what\'s stored');
        console.log('3. The quickProductionAdmin.js script connected to wrong database');
        console.log('');
        console.log('💡 Solution: Need to run admin creation script ON the production server');
        console.log('   SSH into server and run the script there with correct MongoDB URI');
      }
    } else if (error.request) {
      console.log('❌ No response received from server');
      console.log('Error:', error.message);
    } else {
      console.log('❌ Error:', error.message);
    }
  }
}

testLogin();
