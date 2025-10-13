const admin = require('firebase-admin');
const User = require('../models/User');

class FCMService {
  constructor() {
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;

    try {
      // Initialize Firebase Admin SDK
      // You need to download the service account key from Firebase Console
      // and set the path in environment variables
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || '../firebase-service-account.json';
      
      // Resolve the path relative to the project root
      const path = require('path');
      const resolvedPath = path.resolve(__dirname, '..', serviceAccountPath.replace('./', ''));
      
      let serviceAccount;
      try {
        serviceAccount = require(resolvedPath);
      } catch (error) {
        console.log('⚠️  Firebase service account key not found. FCM will not work until you add the key file.');
        console.log('📝 To fix this:');
        console.log('   1. Go to Firebase Console → Project Settings → Service Accounts');
        console.log('   2. Generate a new private key');
        console.log('   3. Save the JSON file as firebase-service-account.json in the backend root');
        console.log('   4. Or set FIREBASE_SERVICE_ACCOUNT_KEY_PATH in .env');
        console.log('🔥 Error details:', error.message);
        return;
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
      });

      this.initialized = true;
      console.log('✅ FCM Service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize FCM Service:', error);
    }
  }

  async sendNotificationToUser(userId, title, body, data = {}) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      const user = await User.findById(userId).select('fcmToken settings');
      if (!user || !user.fcmToken) {
        console.log(`📱 No FCM token for user ${userId}`);
        return false;
      }

      // Check if push notifications are enabled
      if (!user.settings?.pushNotificationsEnabled) {
        console.log(`📱 Push notifications disabled for user ${userId}`);
        return false;
      }

      const message = {
        token: user.fcmToken,
        notification: {
          title: title,
          body: body,
        },
        data: {
          ...data,
          userId: userId.toString(),
          type: 'message'
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        }
      };

      const response = await admin.messaging().send(message);
      console.log(`📱 FCM notification sent to user ${userId}:`, response);
      return true;
    } catch (error) {
      console.error(`❌ Failed to send FCM notification to user ${userId}:`, error);

      // If token is invalid, remove it
      if (error.code === 'messaging/registration-token-not-registered' ||
          error.code === 'messaging/invalid-registration-token') {
        await User.findByIdAndUpdate(userId, { fcmToken: null });
        console.log(`📱 Removed invalid FCM token for user ${userId}`);
      }

      return false;
    }
  }

  async updateUserToken(userId, fcmToken) {
    try {
      await User.findByIdAndUpdate(userId, { fcmToken });
      console.log(`📱 Updated FCM token for user ${userId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to update FCM token for user ${userId}:`, error);
      return false;
    }
  }

  async removeUserToken(userId) {
    try {
      await User.findByIdAndUpdate(userId, { fcmToken: null });
      console.log(`📱 Removed FCM token for user ${userId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to remove FCM token for user ${userId}:`, error);
      return false;
    }
  }
}

module.exports = new FCMService();