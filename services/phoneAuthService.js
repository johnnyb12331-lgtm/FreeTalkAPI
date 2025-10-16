const admin = require('firebase-admin');
const crypto = require('crypto');

/**
 * Firebase Phone Authentication Service for Password Reset
 * Uses Firebase Admin SDK to send SMS verification codes
 */
class PhoneAuthService {
  constructor() {
    this.initialized = false;
    // Store verification codes temporarily (in production, use Redis)
    this.verificationCodes = new Map();
    // Code expiration time (5 minutes)
    this.CODE_EXPIRY = 5 * 60 * 1000;
  }

  /**
   * Initialize Firebase Admin (if not already initialized)
   */
  initialize() {
    if (this.initialized) return true;

    try {
      // Check if Firebase is already initialized by FCM service
      if (admin.apps.length === 0) {
        const path = require('path');
        const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || '../firebase-service-account.json';
        const resolvedPath = path.resolve(__dirname, '..', serviceAccountPath.replace('./', ''));
        
        const serviceAccount = require(resolvedPath);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
        });
        console.log('✅ Firebase Admin initialized for Phone Auth');
      }
      
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Phone Auth Service:', error.message);
      console.log('📝 Make sure you have the Firebase service account JSON file');
      return false;
    }
  }

  /**
   * Generate a 6-digit verification code
   */
  generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Send SMS verification code for password reset
   * @param {string} phoneNumber - Phone number in E.164 format (e.g., +1234567890)
   * @param {string} userId - User ID for tracking
   * @returns {Promise<Object>} Result with success status
   */
  async sendPasswordResetSMS(phoneNumber, userId) {
    if (!this.initialize()) {
      throw new Error('Phone Auth Service not initialized');
    }

    try {
      // Generate verification code
      const code = this.generateVerificationCode();
      
      // Store code with expiration
      const verificationData = {
        code,
        userId,
        phoneNumber,
        createdAt: Date.now(),
        expiresAt: Date.now() + this.CODE_EXPIRY,
        attempts: 0
      };
      
      this.verificationCodes.set(phoneNumber, verificationData);

      // Format phone number message
      const message = `Your FreeTalk password reset code is: ${code}\n\nThis code expires in 5 minutes.\n\nIf you didn't request this, please ignore this message.`;

      // Send SMS using Firebase Authentication REST API
      // Requires Firebase Blaze plan
      // Free tier: 10,000 verifications/month
      try {
        // Try to send SMS using Twilio (primary method)
        const twilio = require('twilio');
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;

        if (accountSid && authToken && fromNumber) {
          // Use Twilio to send SMS with custom message
          const client = twilio(accountSid, authToken);
          
          const smsResult = await client.messages.create({
            body: message,
            from: fromNumber,
            to: phoneNumber
          });

          console.log('✅ SMS sent via Twilio:', smsResult.sid);
          console.log('📱 To:', phoneNumber);
          console.log('👤 User ID:', userId);

          return {
            success: true,
            message: 'Verification code sent successfully',
            messageId: smsResult.sid
          };
        } else {
          // Fallback: Log code if Twilio not configured
          console.warn('⚠️  Twilio not configured. Add TWILIO credentials to .env');
          console.log('📱 SMS Code for', phoneNumber, ':', code);
          console.log('👤 User ID:', userId);
          
          return {
            success: true,
            message: 'Verification code sent successfully',
            ...(process.env.NODE_ENV === 'development' && { verificationCode: code })
          };
        }
      } catch (smsError) {
        console.error('❌ Error sending SMS:', smsError);
        console.error('   Error details:', smsError.message);
        
        // Fallback to logging on error
        console.log('📱 Fallback - SMS Code for', phoneNumber, ':', code);
        console.log('👤 User ID:', userId);
        console.log('💡 SMS failed - returning code in response for development');
        
        // Return code in response when SMS fails (so user can still verify)
        return {
          success: true,
          message: 'SMS delivery failed. Code displayed for testing.',
          verificationCode: code, // Always return code when SMS fails
          smsError: true
        };
      }
    } catch (error) {
      console.error('❌ Phone Auth Service error:', error);
      throw error;
    }
  }

  /**
   * Verify SMS code for password reset
   * @param {string} phoneNumber - Phone number in E.164 format
   * @param {string} code - 6-digit verification code
   * @returns {Promise<Object>} Result with userId if valid
   */
  async verifyPasswordResetCode(phoneNumber, code) {
    try {
      const verificationData = this.verificationCodes.get(phoneNumber);

      if (!verificationData) {
        return {
          success: false,
          message: 'No verification code found for this phone number. Please request a new code.'
        };
      }

      // Check if code has expired
      if (Date.now() > verificationData.expiresAt) {
        this.verificationCodes.delete(phoneNumber);
        return {
          success: false,
          message: 'Verification code has expired. Please request a new code.'
        };
      }

      // Check attempt limit (prevent brute force)
      if (verificationData.attempts >= 5) {
        this.verificationCodes.delete(phoneNumber);
        return {
          success: false,
          message: 'Too many failed attempts. Please request a new code.'
        };
      }

      // Verify code
      if (verificationData.code !== code) {
        verificationData.attempts += 1;
        this.verificationCodes.set(phoneNumber, verificationData);
        return {
          success: false,
          message: `Invalid verification code. ${5 - verificationData.attempts} attempts remaining.`
        };
      }

      // Success! Delete the code and return user info
      this.verificationCodes.delete(phoneNumber);
      
      return {
        success: true,
        userId: verificationData.userId,
        message: 'Verification successful'
      };
    } catch (error) {
      console.error('❌ Error verifying code:', error);
      throw error;
    }
  }

  /**
   * Clean up expired codes (run periodically)
   */
  cleanupExpiredCodes() {
    const now = Date.now();
    for (const [phoneNumber, data] of this.verificationCodes.entries()) {
      if (now > data.expiresAt) {
        this.verificationCodes.delete(phoneNumber);
      }
    }
  }

  /**
   * Get remaining time for a verification code
   * @param {string} phoneNumber 
   * @returns {number} Seconds remaining or 0
   */
  getCodeTimeRemaining(phoneNumber) {
    const data = this.verificationCodes.get(phoneNumber);
    if (!data) return 0;
    
    const remaining = Math.max(0, data.expiresAt - Date.now());
    return Math.floor(remaining / 1000);
  }
}

// Singleton instance
const phoneAuthService = new PhoneAuthService();

// Cleanup expired codes every 5 minutes
setInterval(() => {
  phoneAuthService.cleanupExpiredCodes();
}, 5 * 60 * 1000);

module.exports = phoneAuthService;
