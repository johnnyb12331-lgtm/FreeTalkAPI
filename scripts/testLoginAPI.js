/**
 * Script to test login API directly
 */

const https = require('https');

const loginData = JSON.stringify({
  email: 'bennettjohn558@yahoo.com',
  password: 'gmpq8w9t0'
});

const options = {
  hostname: 'freetalk.site',
  port: 443,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': loginData.length
  }
};

console.log('🔍 Testing login to: https://freetalk.site/api/auth/login');
console.log('📧 Email: bennettjohn558@yahoo.com');
console.log('🔒 Password: gmpq8w9t0\n');

const req = https.request(options, (res) => {
  let data = '';

  console.log(`📊 Status Code: ${res.statusCode}`);
  console.log(`📋 Headers:`, JSON.stringify(res.headers, null, 2));
  console.log('');

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('📦 Response Body:');
    try {
      const parsed = JSON.parse(data);
      console.log(JSON.stringify(parsed, null, 2));
      
      if (parsed.success) {
        console.log('\n✅ Login SUCCESSFUL!');
        console.log('Token:', parsed.data?.accessToken ? 'Generated' : 'Missing');
        console.log('User:', parsed.data?.user?.name);
        console.log('Admin:', parsed.data?.user?.isAdmin);
      } else {
        console.log('\n❌ Login FAILED!');
        console.log('Message:', parsed.message);
      }
    } catch (e) {
      console.log('Raw response:', data);
      console.log('\n⚠️ Could not parse JSON response');
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request Error:', error.message);
});

req.write(loginData);
req.end();
