const express = require('express');
const router = express.Router();
// Make Stripe optional - only initialize if API key is provided
const stripe = process.env.STRIPE_SECRET_KEY 
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');

// TEMPORARY: Helper function to check if user has premium (currently FREE for all)
// TODO: Revert this when premium is enabled
function checkUserPremium(user) {
  // Temporarily making premium free for all users
  return true;
  
  // Original logic (uncomment when reverting):
  // return user.isPremium;
}

function checkPremiumFeature(user, featureName) {
  // Temporarily making all premium features free for all users
  return true;
  
  // Original logic (uncomment when reverting):
  // return user.isPremium && user.premiumFeatures.includes(featureName);
}

// Middleware to check if Stripe is configured
const requireStripe = (req, res, next) => {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      message: 'Payment service is not configured'
    });
  }
  next();
};

// Get subscription status
router.get('/subscription-status', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if premium has expired
    const now = new Date();
    if (user.isPremium && user.premiumExpiresAt && user.premiumExpiresAt < now) {
      user.isPremium = false;
      user.premiumFeatures = [];
      await user.save();
    }

    const daysRemaining = user.premiumExpiresAt 
      ? Math.max(0, Math.ceil((user.premiumExpiresAt - now) / (1000 * 60 * 60 * 24)))
      : 0;

    // Use helper to check premium status (currently returns true for all users)
    const isPremiumActive = checkUserPremium(user);

    res.json({
      success: true,
      data: {
        isPremium: isPremiumActive,
        premiumFeatures: user.premiumFeatures,
        premiumExpiresAt: user.premiumExpiresAt,
        daysRemaining,
        paymentHistory: user.paymentHistory
      }
    });
  } catch (error) {
    console.error('Error getting subscription status:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting subscription status',
      error: error.message
    });
  }
});

// Get available premium tiers
router.get('/premium-tiers', async (req, res) => {
  try {
    const tiers = {
      basic: {
        name: 'Premium Basic',
        price: 4.99,
        currency: 'USD',
        interval: 'month',
        features: [
          'See who viewed your profile',
          'Ad-free experience',
          'Custom themes',
          '5GB increased upload limit'
        ],
        popular: false
      },
      plus: {
        name: 'Premium Plus',
        price: 9.99,
        currency: 'USD',
        interval: 'month',
        features: [
          'Everything in Basic',
          'Unlimited storage',
          'Advanced analytics dashboard',
          'Priority support (24h response)',
          'Download videos',
          'Control read receipts'
        ],
        popular: true
      },
      pro: {
        name: 'Premium Pro',
        price: 19.99,
        currency: 'USD',
        interval: 'month',
        features: [
          'Everything in Plus',
          'Early access to new features',
          'Custom badge color',
          '50GB upload limit',
          'Ghost mode (browse invisibly)',
          'Priority support (12h response)',
          'Exclusive Pro badge'
        ],
        popular: false
      }
    };

    res.json({
      success: true,
      data: {
        tiers,
        note: 'Verification is FREE for everyone! Premium adds exclusive features on top.'
      }
    });
  } catch (error) {
    console.error('Error getting premium tiers:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting premium tiers',
      error: error.message
    });
  }
});

// Create payment intent for premium subscription
router.post('/create-payment-intent', authenticateToken, requireStripe, async (req, res) => {
  try {
    const { tier } = req.body;

    // Define premium tiers and their pricing (monthly)
    const premiumTiers = {
      'basic': { 
        amount: 499, // $4.99/month
        description: 'Premium Basic - Monthly access',
        features: ['profile_visitors', 'ad_free', 'custom_themes', 'increased_upload_limit'],
        duration: '30days'
      },
      'plus': { 
        amount: 999, // $9.99/month
        description: 'Premium Plus - Monthly access',
        features: ['profile_visitors', 'ad_free', 'custom_themes', 'unlimited_storage', 'advanced_analytics', 'priority_support', 'video_downloads', 'read_receipts_control'],
        duration: '30days'
      },
      'pro': { 
        amount: 1999, // $19.99/month
        description: 'Premium Pro - Monthly access (All Features)',
        features: ['profile_visitors', 'ad_free', 'custom_themes', 'unlimited_storage', 'advanced_analytics', 'priority_support', 'early_access', 'custom_badge_color', 'increased_upload_limit', 'video_downloads', 'read_receipts_control', 'ghost_mode'],
        duration: '30days'
      }
    };

    if (!premiumTiers[tier]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid premium tier. Choose: basic, plus, or pro'
      });
    }

    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user already has active premium
    if (user.isPremium && user.premiumExpiresAt > new Date()) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active premium subscription',
        currentTier: user.premiumTier,
        expiresAt: user.premiumExpiresAt
      });
    }

    // Get pricing for the selected tier
    const pricing = premiumTiers[tier];
    const amount = pricing.amount;

    // Create or retrieve Stripe customer
    let customerId = user.stripeCustomerId;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: user._id.toString()
        }
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      customer: customerId,
      metadata: {
        userId: user._id.toString(),
        tier: tier,
        features: pricing.features.join(','),
        duration: pricing.duration
      },
      description: pricing.description,
    });

    res.json({
      success: true,
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      }
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating payment intent',
      error: error.message
    });
  }
});

// Verify payment and activate subscription
router.post('/verify-payment', authenticateToken, requireStripe, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({
        success: false,
        message: 'Payment intent ID is required'
      });
    }

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        success: false,
        message: 'Payment not completed',
        status: paymentIntent.status
      });
    }

    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if payment was already processed
    const existingPayment = user.paymentHistory.find(
      p => p.transactionId === paymentIntentId
    );

    if (existingPayment && existingPayment.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Payment already processed'
      });
    }

    const tier = paymentIntent.metadata.tier;
    const featuresString = paymentIntent.metadata.features;
    const features = featuresString ? featuresString.split(',') : [];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days

    // Activate premium subscription
    user.isPremium = true;
    user.premiumTier = tier;
    
    // Add all features from the tier
    features.forEach(feature => {
      if (!user.premiumFeatures.includes(feature)) {
        user.premiumFeatures.push(feature);
      }
    });
    
    user.premiumExpiresAt = expiresAt;
    user.premiumPurchaseDate = now;

    // Add to payment history
    user.paymentHistory.push({
      amount: paymentIntent.amount / 100, // Convert cents to dollars
      currency: paymentIntent.currency,
      feature: `Premium ${tier.charAt(0).toUpperCase() + tier.slice(1)}`,
      transactionId: paymentIntentId,
      paymentMethod: 'stripe',
      status: 'completed',
      purchasedAt: now
    });

    await user.save();

    res.json({
      success: true,
      message: `🎉 Premium ${tier.toUpperCase()} activated! Welcome to the exclusive club!`,
      data: {
        isPremium: user.isPremium,
        premiumTier: user.premiumTier,
        premiumFeatures: user.premiumFeatures,
        premiumExpiresAt: user.premiumExpiresAt,
        tier: tier
      }
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying payment',
      error: error.message
    });
  }
});

// Webhook for Stripe events (for production use)
router.post('/webhook', requireStripe, express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('💰 Payment succeeded:', paymentIntent.id);
      // Payment verification is handled in verify-payment endpoint
      break;
    
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.error('❌ Payment failed:', failedPayment.id);
      
      // Update payment history if exists
      if (failedPayment.metadata && failedPayment.metadata.userId) {
        const user = await User.findById(failedPayment.metadata.userId);
        if (user) {
          const payment = user.paymentHistory.find(
            p => p.transactionId === failedPayment.id
          );
          if (payment) {
            payment.status = 'failed';
            await user.save();
          }
        }
      }
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({received: true});
});

// Check if feature is accessible (helper endpoint)
router.get('/check-feature/:feature', authenticateToken, async (req, res) => {
  try {
    const { feature } = req.params;
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if premium has expired
    const now = new Date();
    if (user.isPremium && user.premiumExpiresAt && user.premiumExpiresAt < now) {
      user.isPremium = false;
      user.premiumFeatures = [];
      await user.save();
    }

    // Use helper to check feature access (currently returns true for all users)
    const hasAccess = checkPremiumFeature(user, feature);
    const isPremiumActive = checkUserPremium(user);

    res.json({
      success: true,
      data: {
        hasAccess,
        isPremium: isPremiumActive,
        feature,
        expiresAt: user.premiumExpiresAt
      }
    });
  } catch (error) {
    console.error('Error checking feature access:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking feature access',
      error: error.message
    });
  }
});

module.exports = router;
