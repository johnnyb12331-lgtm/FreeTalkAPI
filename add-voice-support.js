const fs = require('fs');
const path = require('path');

const filePath = '/root/FreeTalkAPI/routes/messages.js';

// Read the file
let content = fs.readFileSync(filePath, 'utf8');

// Define the audio handling code to insert
const audioHandling = `        } else if (req.file.mimetype.startsWith('audio/')) {
          messageData.type = 'voice';
          // Add duration if provided by client
          if (req.body.duration) {
            messageData.duration = parseFloat(req.body.duration);
          }
          // Add waveform data if provided by client
          if (req.body.waveformData) {
            try {
              messageData.waveformData = JSON.parse(req.body.waveformData);
            } catch (e) {
              console.error('Failed to parse waveform data:', e);
            }
          }`;

// Find the video handling block and insert audio handling after it
const videoBlock = `        } else if (req.file.mimetype.startsWith('video/')) {
          messageData.type = 'video';
          // For videos, you could generate a thumbnail here
          // For now, we'll use the video itself as thumbnail
          messageData.thumbnail = mediaUrl;`;

const replacement = videoBlock + '\n' + audioHandling;

// Check if audio handling already exists
if (content.includes("mimetype.startsWith('audio/')")) {
  console.log('✅ Audio handling already exists');
  process.exit(0);
}

// Replace
const newContent = content.replace(videoBlock, replacement);

if (newContent === content) {
  console.log('❌ Failed to find video block to replace');
  process.exit(1);
}

// Backup original
fs.writeFileSync(filePath + '.backup', content);
console.log('📝 Created backup: ' + filePath + '.backup');

// Write new content
fs.writeFileSync(filePath, newContent);
console.log('✅ Successfully added audio handling to messages.js');

// Verify
const verify = fs.readFileSync(filePath, 'utf8');
if (verify.includes("mimetype.startsWith('audio/')")) {
  console.log('✅ Verification passed - audio handling is present');
} else {
  console.log('❌ Verification failed - restoring backup');
  fs.writeFileSync(filePath, content);
  process.exit(1);
}
