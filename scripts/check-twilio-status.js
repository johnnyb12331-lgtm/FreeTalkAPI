#!/usr/bin/env node

/**
 * Check Twilio Account Status
 * Verifies Twilio configuration and account details
 */

require('dotenv').config();
const twilio = require('twilio');

async function checkTwilioStatus() {
  console.log('\n🔍 Checking Twilio Account Status\n');
  console.log('================================');

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.error('❌ Twilio credentials not configured in .env file');
    process.exit(1);
  }

  try {
    const client = twilio(accountSid, authToken);
    
    // Get account info
    console.log('📊 Account Information:');
    const account = await client.api.accounts(accountSid).fetch();
    console.log(`   Status: ${account.status}`);
    console.log(`   Type: ${account.type}`);
    console.log(`   Name: ${account.friendlyName}`);
    console.log('');

    // Check if trial account
    if (account.type === 'Trial') {
      console.log('⚠️  TRIAL ACCOUNT DETECTED');
      console.log('================================');
      console.log('Trial accounts have restrictions:');
      console.log('1. Can only send SMS to VERIFIED phone numbers');
      console.log('2. All SMS will include a trial message prefix');
      console.log('3. Limited number of messages');
      console.log('');
      console.log('To send SMS to any number:');
      console.log('• Upgrade to a paid Twilio account');
      console.log('• Or verify the recipient phone number at:');
      console.log('  https://console.twilio.com/us1/develop/phone-numbers/manage/verified');
      console.log('================================\n');
    }

    // Get balance
    try {
      const balance = await client.balance.fetch();
      console.log(`💰 Balance: ${balance.currency} ${balance.balance}`);
    } catch (e) {
      console.log('💰 Balance: Unable to fetch');
    }

    // List verified phone numbers (for trial accounts)
    if (account.type === 'Trial') {
      console.log('\n📱 Verified Phone Numbers:');
      try {
        const validationRequests = await client.validationRequests.list({ limit: 20 });
        if (validationRequests.length === 0) {
          console.log('   ❌ No verified phone numbers found');
          console.log('   → Add verified numbers at: https://console.twilio.com/us1/develop/phone-numbers/manage/verified');
        } else {
          validationRequests.forEach((validation) => {
            console.log(`   ✅ ${validation.phoneNumber}`);
          });
        }
      } catch (e) {
        console.log('   Unable to fetch verified numbers');
      }
    }

    // Check the from number
    console.log('\n📤 From Number Information:');
    try {
      const phoneNumber = await client.incomingPhoneNumbers.list({ phoneNumber: fromNumber, limit: 1 });
      if (phoneNumber.length > 0) {
        console.log(`   ✅ ${fromNumber} is active`);
        console.log(`   Capabilities: Voice: ${phoneNumber[0].capabilities.voice}, SMS: ${phoneNumber[0].capabilities.sms}`);
      } else {
        console.log(`   ⚠️  ${fromNumber} not found in your account`);
      }
    } catch (e) {
      console.log(`   ⚠️  Unable to verify ${fromNumber}`);
    }

    // Recent messages
    console.log('\n📨 Recent Messages (last 5):');
    try {
      const messages = await client.messages.list({ limit: 5 });
      if (messages.length === 0) {
        console.log('   No messages found');
      } else {
        messages.forEach((msg, i) => {
          console.log(`\n   ${i + 1}. ${msg.sid}`);
          console.log(`      To: ${msg.to}`);
          console.log(`      Status: ${msg.status}`);
          console.log(`      Date: ${msg.dateCreated}`);
          if (msg.errorCode) {
            console.log(`      ❌ Error: ${msg.errorCode} - ${msg.errorMessage}`);
          }
        });
      }
    } catch (e) {
      console.log('   Unable to fetch recent messages');
    }

    console.log('\n================================\n');

  } catch (error) {
    console.error('\n❌ Error checking Twilio status:');
    console.error(`   ${error.message}`);
    if (error.code === 20003) {
      console.error('\n   Invalid Twilio credentials. Please check:');
      console.error('   • TWILIO_ACCOUNT_SID');
      console.error('   • TWILIO_AUTH_TOKEN');
    }
    console.error('\n');
    process.exit(1);
  }
}

checkTwilioStatus();
