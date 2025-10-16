#!/usr/bin/env node

/**
 * Test SMS Service
 * Sends a test SMS to verify Twilio configuration
 * 
 * Usage: node scripts/test-sms.js <phoneNumber>
 * Example: node scripts/test-sms.js +16629980120
 */

require('dotenv').config();
const twilio = require('twilio');

async function sendTestSMS() {
  const phoneNumber = process.argv[2];
  
  if (!phoneNumber) {
    console.error('❌ Please provide a phone number');
    console.log('Usage: node scripts/test-sms.js <phoneNumber>');
    console.log('Example: node scripts/test-sms.js +16629980120');
    process.exit(1);
  }

  // Validate E.164 format
  if (!phoneNumber.match(/^\+[1-9]\d{1,14}$/)) {
    console.error('❌ Phone number must be in E.164 format (e.g., +16629980120)');
    process.exit(1);
  }

  console.log('\n📱 Testing Twilio SMS Service\n');
  console.log('================================');

  // Check credentials
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  console.log(`Account SID: ${accountSid ? '✅ Set' : '❌ Not set'}`);
  console.log(`Auth Token: ${authToken ? '✅ Set' : '❌ Not set'}`);
  console.log(`From Number: ${fromNumber || '❌ Not set'}`);
  console.log(`To Number: ${phoneNumber}`);
  console.log('================================\n');

  if (!accountSid || !authToken || !fromNumber) {
    console.error('❌ Twilio credentials not configured in .env file');
    process.exit(1);
  }

  try {
    const client = twilio(accountSid, authToken);
    
    // Generate a test code
    const testCode = Math.floor(100000 + Math.random() * 900000).toString();
    const message = `Your FreeTalk verification code is: ${testCode}\n\nThis is a test message. This code expires in 5 minutes.`;

    console.log('📤 Sending SMS...\n');
    console.log(`Message: ${message}\n`);

    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: phoneNumber
    });

    console.log('================================');
    console.log('✅ SMS sent successfully!');
    console.log('================================');
    console.log(`Message SID: ${result.sid}`);
    console.log(`Status: ${result.status}`);
    console.log(`To: ${result.to}`);
    console.log(`From: ${result.from}`);
    console.log(`Date Created: ${result.dateCreated}`);
    console.log('================================\n');
    console.log(`🔢 Test Code: ${testCode}`);
    console.log('\n✅ Check your phone for the SMS!');

  } catch (error) {
    console.error('\n================================');
    console.error('❌ Error sending SMS');
    console.error('================================');
    console.error(`Error: ${error.message}`);
    console.error(`Code: ${error.code}`);
    console.error(`Status: ${error.status}`);
    console.error('\nCommon Issues:');
    console.error('1. Invalid Twilio credentials');
    console.error('2. Phone number not verified (trial account)');
    console.error('3. Insufficient balance');
    console.error('4. Invalid phone number format');
    console.error('================================\n');
    process.exit(1);
  }
}

sendTestSMS();
