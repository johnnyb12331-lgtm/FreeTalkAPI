#!/usr/bin/env node

/**
 * Message Notification System Verification Script
 * 
 * This script helps verify that the message notification system is properly configured.
 * Run this from the FreeTalkAPI directory: node verify-message-notifications.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 MESSAGE NOTIFICATION SYSTEM VERIFICATION');
console.log('==========================================\n');

let issuesFound = 0;
let checksCompleted = 0;

function checkFile(filePath, checks) {
  checksCompleted++;
  console.log(`📄 Checking ${filePath}...`);
  
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`   ❌ File not found: ${filePath}\n`);
      issuesFound++;
      return false;
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    for (const check of checks) {
      if (content.includes(check.text)) {
        console.log(`   ✅ ${check.description}`);
      } else {
        console.log(`   ❌ ${check.description} - NOT FOUND`);
        issuesFound++;
      }
    }
    console.log('');
    return true;
  } catch (error) {
    console.log(`   ❌ Error reading file: ${error.message}\n`);
    issuesFound++;
    return false;
  }
}

// Check 1: Backend message routes
checkFile('routes/messages.js', [
  {
    text: "io.to(`user:${recipient}`).emit('message:new'",
    description: 'Backend emits message:new event with correct room format'
  },
  {
    text: "io.to(`user:${recipient}`).emit('message:unread-count'",
    description: 'Backend emits message:unread-count event'
  },
  {
    text: "io.to(`user:${recipient}`).emit('notification:new'",
    description: 'Backend emits notification:new event for messages'
  },
  {
    text: "type: 'message'",
    description: 'Notification type is set to "message"'
  }
]);

// Check 2: Server socket setup
checkFile('server.js', [
  {
    text: "socket.on('authenticate'",
    description: 'Server handles socket authentication'
  },
  {
    text: "socket.join(`user:${userId}`)",
    description: 'Users join their socket room with correct format'
  },
  {
    text: 'const userSockets = new Map()',
    description: 'Server tracks user socket connections'
  }
]);

// Check 3: Conversation model
checkFile('models/Conversation.js', [
  {
    text: 'incrementUnread',
    description: 'Conversation model has unread increment method'
  },
  {
    text: 'getUnreadCount',
    description: 'Conversation model has unread count getter'
  },
  {
    text: 'resetUnread',
    description: 'Conversation model has unread reset method'
  }
]);

console.log('==========================================');
console.log(`📊 Verification Complete`);
console.log(`   Total checks: ${checksCompleted}`);
console.log(`   Issues found: ${issuesFound}`);

if (issuesFound === 0) {
  console.log('\n✅ All backend checks passed! Message notifications should work.');
  console.log('\nIf users still aren\'t receiving notifications, check:');
  console.log('1. Socket connection status in client app');
  console.log('2. Network/firewall settings');
  console.log('3. Client-side event listeners');
  console.log('4. Browser console for errors');
} else {
  console.log(`\n⚠️  Found ${issuesFound} issues that need attention.`);
  console.log('Please review the output above and fix the issues.');
}

console.log('\n📝 For detailed troubleshooting, see:');
console.log('   MESSAGE_NOTIFICATION_STATUS.md');
console.log('==========================================\n');
