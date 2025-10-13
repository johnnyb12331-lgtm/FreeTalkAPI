const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const iap = require('in-app-purchase');

const router = express.Router();

// Configure in-app-purchase library
let googleServiceAccount = null;
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
  try {
    googleServiceAccount = require(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH);
  } catch (error) {
    console.warn('⚠️  Google Service Account file not found. Google Play IAP verification will be disabled.');
  }
}

iap.config({
  // Apple configuration
  applePassword: process.env.APPLE_SHARED_SECRET,
  // Use sandbox for testing, production for live
  test: process.env.IAP_ENVIRONMENT === 'sandbox' || process.env.NODE_ENV !== 'production',
  
  // Google configuration
  googleServiceAccount: googleServiceAccount,
  
  verbose: process.env.NODE_ENV !== 'production'
});

// @route   POST /api/iap/verify-purchase
// @desc    Verify in-app purchase (iOS StoreKit or Android Play Billing)
// @access  Private
router.post('/verify-purchase', authenticateToken, [
  body('platform')
    .isIn(['ios', 'android'])
    .withMessage('Platform must be ios or android'),
  body('productId')
    .notEmpty()
    .withMessage('Product ID is required'),
  body('receipt')
    .optional()
    .notEmpty()
    .withMessage('Receipt is required for iOS'),
  body('purchaseToken')
    .optional()
    .notEmpty()
    .withMessage('Purchase token is required for Android'),
  body('packageName')
    .optional()
    .notEmpty()
    .withMessage('Package name is required for Android'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { platform, productId, receipt, purchaseToken, packageName } = req.body;
    const userId = req.user.userId;

    console.log(`🛒 IAP Verification Request:`, {
      userId,
      platform,
      productId
    });

    // Validate product ID
    const validProducts = [
      'com.freetalk.premium_monthly',
      'com.freetalk.premium_yearly',
      'com.freetalk.verified_badge',
      'com.freetalk.ad_free'
    ];

    if (!validProducts.includes(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID'
      });
    }

    let verificationResult;

    if (platform === 'ios') {
      // iOS StoreKit receipt verification
      verificationResult = await verifyAppleReceipt(receipt, productId);
    } else if (platform === 'android') {
      // Android Play Billing verification
      verificationResult = await verifyGooglePurchase(packageName, productId, purchaseToken);
    }

    if (!verificationResult || !verificationResult.valid) {
      return res.status(400).json({
        success: false,
        message: 'Purchase verification failed',
        error: verificationResult?.error || 'Invalid receipt or purchase token'
      });
    }

    // Grant entitlements based on product
    const entitlements = await grantEntitlements(userId, productId, verificationResult);

    res.status(200).json({
      success: true,
      message: 'Purchase verified successfully',
      data: {
        productId,
        validUntil: entitlements.validUntil,
        entitlements: entitlements.granted
      }
    });

  } catch (error) {
    console.error('IAP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Purchase verification failed. Please contact support.'
    });
  }
});

// @route   GET /api/iap/entitlements
// @desc    Get user's current entitlements
// @access  Private
router.get('/entitlements', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // TODO: Query user's purchases from database
    // For now, return mock data
    const entitlements = {
      premium: false,
      verified: false,
      adFree: false,
      validUntil: null
    };

    res.status(200).json({
      success: true,
      data: { entitlements }
    });

  } catch (error) {
    console.error('Get entitlements error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get entitlements'
    });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Verify Apple App Store receipt
 * @param {string} receipt - Base64 encoded receipt from iOS
 * @param {string} productId - Product identifier
 * @returns {Promise<Object>} Verification result
 */
async function verifyAppleReceipt(receipt, productId) {
  console.log('🍎 Verifying Apple receipt for:', productId);
  
  // Check if Apple Shared Secret is configured
  if (!process.env.APPLE_SHARED_SECRET || process.env.APPLE_SHARED_SECRET === 'YOUR_APPLE_SHARED_SECRET_HERE') {
    console.error('❌ APPLE_SHARED_SECRET not configured in .env file!');
    return { 
      valid: false, 
      error: 'Server configuration error. Please contact support.' 
    };
  }

  try {
    // Setup and validate receipt
    await iap.setup();
    
    const validationResponse = await iap.validate({
      receipt: receipt,
      platform: 'apple'
    });

    if (!validationResponse || validationResponse.length === 0) {
      console.error('❌ Empty validation response from Apple');
      return { valid: false, error: 'Invalid receipt' };
    }

    // Find the specific purchase for this product
    const purchase = validationResponse.find(item => item.productId === productId);

    if (!purchase) {
      console.error('❌ Product not found in receipt:', productId);
      return { valid: false, error: 'Product not found in receipt' };
    }

    // Check if purchase is valid and not expired
    const now = Date.now();
    let isValid = true;
    let expiryDate = null;

    // For subscriptions, check expiry
    if (purchase.expirationDate) {
      expiryDate = new Date(purchase.expirationDate);
      isValid = expiryDate > now;
    }

    if (!isValid) {
      console.warn('⚠️ Purchase expired:', productId);
      return { valid: false, error: 'Subscription expired' };
    }

    console.log('✅ Apple receipt verified successfully:', productId);

    return {
      valid: true,
      transactionId: purchase.transactionId,
      originalTransactionId: purchase.originalTransactionId,
      expiryDate: expiryDate,
      productId: purchase.productId,
      purchaseDate: new Date(purchase.purchaseDate)
    };

  } catch (error) {
    console.error('❌ Apple verification error:', error);
    
    // If it's a network error to Apple servers, return more specific error
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return { 
        valid: false, 
        error: 'Unable to verify with Apple servers. Please try again.' 
      };
    }
    
    return { valid: false, error: error.message || 'Verification failed' };
  }
}

/**
 * Verify Google Play Store purchase
 * @param {string} packageName - App package name
 * @param {string} productId - Product identifier
 * @param {string} purchaseToken - Purchase token from Google Play
 * @returns {Promise<Object>} Verification result
 */
async function verifyGooglePurchase(packageName, productId, purchaseToken) {
  console.log('🤖 Verifying Google Play purchase for:', productId);
  
  // Check if Google Service Account is configured
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
    console.error('❌ GOOGLE_SERVICE_ACCOUNT_KEY_PATH not configured in .env file!');
    return { 
      valid: false, 
      error: 'Server configuration error. Please contact support.' 
    };
  }

  // Validate package name
  if (packageName !== 'com.freetalk.social') {
    console.error('❌ Invalid package name:', packageName);
    return { valid: false, error: 'Invalid package name' };
  }

  try {
    // Setup and validate purchase
    await iap.setup();
    
    const validationResponse = await iap.validate({
      receipt: purchaseToken,
      platform: 'google',
      productId: productId,
      packageName: packageName
    });

    if (!validationResponse || validationResponse.length === 0) {
      console.error('❌ Empty validation response from Google');
      return { valid: false, error: 'Invalid purchase token' };
    }

    const purchase = validationResponse[0];

    // Check purchase state (0 = purchased, 1 = cancelled)
    if (purchase.purchaseState === 1) {
      console.warn('⚠️ Purchase was cancelled:', productId);
      return { valid: false, error: 'Purchase was cancelled' };
    }

    // For subscriptions, check if expired
    if (purchase.expirationDate) {
      const expiryDate = new Date(purchase.expirationDate);
      if (expiryDate < Date.now()) {
        console.warn('⚠️ Subscription expired:', productId);
        return { valid: false, error: 'Subscription expired' };
      }
    }

    console.log('✅ Google Play purchase verified successfully:', productId);

    return {
      valid: true,
      orderId: purchase.orderId,
      purchaseTimeMillis: purchase.purchaseDate,
      purchaseState: purchase.purchaseState,
      productId: purchase.productId,
      expirationDate: purchase.expirationDate ? new Date(purchase.expirationDate) : null
    };

  } catch (error) {
    console.error('❌ Google Play verification error:', error);
    
    // Check for specific Google API errors
    if (error.code === 401) {
      return { 
        valid: false, 
        error: 'Google authentication failed. Check service account configuration.' 
      };
    }
    
    if (error.code === 404) {
      return { 
        valid: false, 
        error: 'Purchase not found. It may have been refunded or is invalid.' 
      };
    }
    
    return { valid: false, error: error.message || 'Verification failed' };
  }
}

/**
 * Grant user entitlements based on purchase
 * @param {string} userId - User ID
 * @param {string} productId - Product identifier
 * @param {Object} verificationResult - Verification result from platform
 * @returns {Promise<Object>} Entitlements granted
 */
async function grantEntitlements(userId, productId, verificationResult) {
  // TODO: CRITICAL - Implement entitlement granting logic
  // 1. Store purchase record in database
  // 2. Update user's subscription status
  // 3. Set expiry dates for subscriptions
  // 4. Grant badges, remove ads, etc.
  
  console.log('🎁 Granting entitlements:', {
    userId,
    productId,
    transactionId: verificationResult.transactionId || verificationResult.orderId
  });

  // MOCK ENTITLEMENTS (REPLACE WITH DATABASE LOGIC)
  const entitlements = {
    validUntil: verificationResult.expiryDate || null,
    granted: []
  };

  switch (productId) {
    case 'com.freetalk.premium_monthly':
    case 'com.freetalk.premium_yearly':
      entitlements.granted = ['premium', 'ad_free', 'unlimited_posts'];
      break;
    case 'com.freetalk.verified_badge':
      entitlements.granted = ['verified_badge'];
      break;
    case 'com.freetalk.ad_free':
      entitlements.granted = ['ad_free'];
      break;
  }

  // TODO: Save to database
  // await Purchase.create({
  //   userId,
  //   productId,
  //   platform: verificationResult.transactionId ? 'ios' : 'android',
  //   transactionId: verificationResult.transactionId || verificationResult.orderId,
  //   validUntil: entitlements.validUntil,
  //   createdAt: new Date()
  // });

  return entitlements;
}

module.exports = router;
