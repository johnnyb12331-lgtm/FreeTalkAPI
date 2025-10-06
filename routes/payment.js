const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const auth = require('../middleware/auth');
const User = require('../models/User');

// Get subscription status
router.get('/subscription-status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    
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

    res.json({
      success: true,
      data: {
        isPremium: user.isPremium,
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

// Create payment intent for profile visitors feature
router.post('/create-payment-intent', auth, async (req, res) => {
  try {
    const { feature } = req.body;

    // Define valid features and their prices
    const featurePricing = {
      'profile_visitors': { amount: 300, description: 'Profile Visitors Feature - 30 days access', duration: '30days' },
      'verified_badge': { amount: 799, description: 'Verified Badge - 30 days access', duration: '30days' }
    };

    if (!featurePricing[feature]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid feature'
      });
    }

    const user = await User.findById(req.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user already has active premium for this feature
    if (user.isPremium && 
        user.premiumFeatures.includes(feature) && 
        user.premiumExpiresAt > new Date()) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active subscription for this feature'
      });
    }

    // Get pricing for the selected feature
    const pricing = featurePricing[feature];
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
        feature: feature,
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
router.post('/verify-payment', auth, async (req, res) => {
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

    const user = await User.findById(req.userId);
    
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

    const feature = paymentIntent.metadata.feature;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days

    // Activate premium subscription
    user.isPremium = true;
    
    if (!user.premiumFeatures.includes(feature)) {
      user.premiumFeatures.push(feature);
    }
    
    user.premiumExpiresAt = expiresAt;
    user.premiumPurchaseDate = now;

    // Add to payment history
    user.paymentHistory.push({
      amount: paymentIntent.amount / 100, // Convert cents to dollars
      currency: paymentIntent.currency,
      feature: feature,
      transactionId: paymentIntentId,
      paymentMethod: 'stripe',
      status: 'completed',
      purchasedAt: now
    });

    await user.save();

    res.json({
      success: true,
      message: 'Payment verified and premium activated',
      data: {
        isPremium: user.isPremium,
        premiumFeatures: user.premiumFeatures,
        premiumExpiresAt: user.premiumExpiresAt,
        feature: feature
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
router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
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
router.get('/check-feature/:feature', auth, async (req, res) => {
  try {
    const { feature } = req.params;
    const user = await User.findById(req.userId);
    
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

    const hasAccess = user.isPremium && user.premiumFeatures.includes(feature);

    res.json({
      success: true,
      data: {
        hasAccess,
        isPremium: user.isPremium,
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
