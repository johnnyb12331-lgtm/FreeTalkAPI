const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Test voice message upload
async function testVoiceUpload() {
  console.log('🧪 Testing voice message upload...\n');

  // You'll need to replace these with actual values
  const TOKEN = 'YOUR_AUTH_TOKEN_HERE'; // Get from browser DevTools localStorage
  const RECIPIENT_ID = 'YOUR_RECIPIENT_USER_ID_HERE';
  const API_URL = 'https://freetalk.site/api/messages';

  // Create a simple test WAV file (just for structure testing)
  const testWavPath = path.join(__dirname, 'test-voice.wav');
  
  // Create a minimal WAV file header (44 bytes) + some audio data
  const wavHeader = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x24, 0x00, 0x00, 0x00, // File size - 8
    0x57, 0x41, 0x56, 0x45, // "WAVE"
    0x66, 0x6D, 0x74, 0x20, // "fmt "
    0x10, 0x00, 0x00, 0x00, // Subchunk1Size (16 for PCM)
    0x01, 0x00,             // AudioFormat (1 for PCM)
    0x01, 0x00,             // NumChannels (1 for mono)
    0x44, 0xAC, 0x00, 0x00, // SampleRate (44100)
    0x88, 0x58, 0x01, 0x00, // ByteRate
    0x02, 0x00,             // BlockAlign
    0x10, 0x00,             // BitsPerSample (16)
    0x64, 0x61, 0x74, 0x61, // "data"
    0x00, 0x00, 0x00, 0x00  // Subchunk2Size
  ]);
  
  // Add some silent audio data (100 bytes)
  const audioData = Buffer.alloc(100, 0);
  const testWav = Buffer.concat([wavHeader, audioData]);
  
  fs.writeFileSync(testWavPath, testWav);
  console.log(`✅ Created test WAV file: ${testWavPath}`);
  console.log(`📊 File size: ${testWav.length} bytes\n`);

  // Create form data
  const form = new FormData();
  form.append('recipient', RECIPIENT_ID);
  form.append('duration', '5');
  form.append('media', fs.createReadStream(testWavPath), {
    filename: 'voice_message_test.wav',
    contentType: 'audio/wav'
  });

  console.log('📤 Sending request to:', API_URL);
  console.log('🔑 Using token:', TOKEN.substring(0, 20) + '...');
  console.log('👤 Recipient:', RECIPIENT_ID);
  console.log('⏱️  Duration: 5 seconds\n');

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        ...form.getHeaders()
      },
      body: form
    });

    const responseText = await response.text();
    console.log('📥 Response status:', response.status);
    console.log('📥 Response headers:', JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));
    console.log('📥 Response body:', responseText);

    if (!response.ok) {
      console.log('\n❌ Upload failed!');
      try {
        const json = JSON.parse(responseText);
        console.log('Error details:', JSON.stringify(json, null, 2));
      } catch (e) {
        console.log('Raw error:', responseText);
      }
    } else {
      console.log('\n✅ Upload successful!');
    }

  } catch (error) {
    console.error('\n❌ Request failed:', error.message);
    console.error(error.stack);
  } finally {
    // Cleanup
    if (fs.existsSync(testWavPath)) {
      fs.unlinkSync(testWavPath);
      console.log('\n🧹 Cleaned up test file');
    }
  }
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║         Voice Message Upload Diagnostic Tool              ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📝 INSTRUCTIONS:');
console.log('1. Open https://freetalk.site in your browser');
console.log('2. Open DevTools (F12) > Console');
console.log('3. Run: localStorage.getItem("token")');
console.log('4. Copy the token value');
console.log('5. Edit this file and replace YOUR_AUTH_TOKEN_HERE with your token');
console.log('6. Get a recipient user ID (from a chat or user profile)');
console.log('7. Replace YOUR_RECIPIENT_USER_ID_HERE with the user ID');
console.log('8. Run: node test-voice-upload.js\n');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.exit(0);
}

// Check if values are set
const hasToken = !/__YOUR_AUTH_TOKEN_HERE/.test(fs.readFileSync(__filename, 'utf8'));
const hasRecipient = !/__YOUR_RECIPIENT_USER_ID_HERE/.test(fs.readFileSync(__filename, 'utf8'));

if (!hasToken || !hasRecipient) {
  console.log('⚠️  Please edit this file and set your TOKEN and RECIPIENT_ID first!');
  console.log('   Then run: node test-voice-upload.js\n');
  process.exit(1);
}

testVoiceUpload();
