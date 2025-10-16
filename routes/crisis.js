const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const CrisisResponse = require('../models/CrisisResponse');
const User = require('../models/User');
const Notification = require('../models/Notification');

// Emergency hotlines database
const EMERGENCY_RESOURCES = {
  suicide_prevention: [
    { name: '988 Suicide & Crisis Lifeline', contact: '988', description: '24/7 crisis support', country: 'US' },
    { name: 'Crisis Text Line', contact: 'Text HOME to 741741', description: 'Free 24/7 crisis support via text', country: 'US' }
  ],
  mental_health: [
    { name: 'SAMHSA National Helpline', contact: '1-800-662-4357', description: 'Mental health and substance abuse support', country: 'US' },
    { name: 'NAMI Helpline', contact: '1-800-950-6264', description: 'Mental health information and support', country: 'US' }
  ],
  domestic_violence: [
    { name: 'National Domestic Violence Hotline', contact: '1-800-799-7233', description: '24/7 confidential support', country: 'US' },
    { name: 'National Dating Abuse Helpline', contact: '1-866-331-9474', description: 'Support for dating violence', country: 'US' }
  ],
  medical_emergency: [
    { name: 'Emergency Services', contact: '911', description: 'Immediate emergency response', country: 'US' },
    { name: 'Poison Control', contact: '1-800-222-1222', description: '24/7 poison emergency assistance', country: 'US' }
  ],
  substance_abuse: [
    { name: 'SAMHSA National Helpline', contact: '1-800-662-4357', description: 'Treatment referral and information', country: 'US' },
    { name: 'Marijuana Anonymous', contact: '1-800-766-6779', description: '12-step recovery program', country: 'US' }
  ]
};

// Get emergency resources based on crisis type
router.get('/resources/:crisisType', authenticateToken, async (req, res) => {
  try {
    const { crisisType } = req.params;
    const resources = EMERGENCY_RESOURCES[crisisType] || [];
    
    res.json({
      success: true,
      crisisType,
      resources,
      emergencyNumber: '911',
      suicidePreventionLifeline: '988'
    });
  } catch (error) {
    console.error('Error fetching crisis resources:', error);
    res.status(500).json({ error: 'Failed to fetch resources' });
  }
});

// Create a new crisis response request
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      crisisType,
      severity,
      description,
      location,
      contactPhone,
      isAnonymous,
      visibility,
      emergencyContactIds
    } = req.body;

    // Validate required fields
    if (!crisisType || !severity || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create the crisis response
    const crisisResponse = new CrisisResponse({
      user: req.userId,
      crisisType,
      severity,
      description,
      location,
      contactPhone,
      isAnonymous: isAnonymous || false,
      visibility: visibility || 'friends',
      status: 'active'
    });

    await crisisResponse.save();

    // Populate user data
    await crisisResponse.populate('user', 'name profilePicture');

    // Get IO instance from app
    const io = req.app.get('io');
    const userSockets = req.app.get('userSockets');

    // Notify emergency contacts if specified
    if (emergencyContactIds && emergencyContactIds.length > 0) {
      const contacts = await User.find({ _id: { $in: emergencyContactIds } });
      
      for (const contact of contacts) {
        // Create notification
        const notification = new Notification({
          recipient: contact._id,
          sender: req.userId,
          type: 'crisis_alert',
          message: isAnonymous ? 'Someone needs help' : `${crisisResponse.user.name} needs help`,
          crisisResponse: crisisResponse._id,
          isRead: false
        });
        await notification.save();

        // Send real-time notification
        if (userSockets.has(contact._id.toString())) {
          const socketIds = userSockets.get(contact._id.toString());
          socketIds.forEach(socketId => {
            io.to(socketId).emit('crisis_alert', {
              crisisId: crisisResponse._id,
              type: crisisType,
              severity,
              message: notification.message,
              isAnonymous,
              createdAt: crisisResponse.createdAt
            });
          });
        }

        crisisResponse.emergencyContactsNotified.push(contact._id);
      }

      await crisisResponse.save();
    }

    // Broadcast to community based on visibility
    if (visibility === 'community' || visibility === 'friends') {
      io.emit('new_crisis_alert', {
        crisisId: crisisResponse._id,
        type: crisisType,
        severity,
        visibility,
        isAnonymous,
        location: location ? {
          address: location.address
        } : null,
        createdAt: crisisResponse.createdAt
      });
    }

    res.status(201).json({
      success: true,
      message: 'Crisis response request created',
      crisisResponse
    });
  } catch (error) {
    console.error('Error creating crisis response:', error);
    res.status(500).json({ error: 'Failed to create crisis response' });
  }
});

// Get active crisis alerts (filtered by visibility)
router.get('/active', authenticateToken, async (req, res) => {
  try {
    const { severity, crisisType, limit = 20 } = req.query;
    
    const query = { status: { $in: ['active', 'in_progress'] } };
    
    if (severity) {
      query.severity = severity;
    }
    if (crisisType) {
      query.crisisType = crisisType;
    }

    // Get user's friends to filter by visibility
    const currentUser = await User.findById(req.userId);
    const friendIds = currentUser.friends.map(f => f.toString());

    // Filter by visibility
    query.$or = [
      { visibility: 'community' },
      { visibility: 'friends', user: { $in: friendIds } },
      { user: req.userId }
    ];

    const crisisAlerts = await CrisisResponse.find(query)
      .populate('user', 'name profilePicture')
      .populate('helpers.user', 'name profilePicture')
      .sort({ severity: -1, createdAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      count: crisisAlerts.length,
      crisisAlerts
    });
  } catch (error) {
    console.error('Error fetching active crisis alerts:', error);
    res.status(500).json({ error: 'Failed to fetch crisis alerts' });
  }
});

// Get a specific crisis response
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const crisisResponse = await CrisisResponse.findById(req.params.id)
      .populate('user', 'name profilePicture email')
      .populate('helpers.user', 'name profilePicture')
      .populate('emergencyContactsNotified', 'name profilePicture')
      .populate('safetyChecks.checkedBy', 'name profilePicture')
      .populate('updates.user', 'name profilePicture')
      .populate('resourcesProvided.providedBy', 'name profilePicture');

    if (!crisisResponse) {
      return res.status(404).json({ error: 'Crisis response not found' });
    }

    // Check if user has permission to view
    const currentUser = await User.findById(req.userId);
    const friendIds = currentUser.friends.map(f => f.toString());
    const canView = 
      crisisResponse.user._id.toString() === req.userId ||
      crisisResponse.visibility === 'community' ||
      (crisisResponse.visibility === 'friends' && friendIds.includes(crisisResponse.user._id.toString())) ||
      crisisResponse.emergencyContactsNotified.some(c => c._id.toString() === req.userId) ||
      crisisResponse.helpers.some(h => h.user._id.toString() === req.userId);

    if (!canView) {
      return res.status(403).json({ error: 'Not authorized to view this crisis response' });
    }

    res.json({
      success: true,
      crisisResponse
    });
  } catch (error) {
    console.error('Error fetching crisis response:', error);
    res.status(500).json({ error: 'Failed to fetch crisis response' });
  }
});

// Offer help for a crisis
router.post('/:id/offer-help', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    const crisisResponse = await CrisisResponse.findById(req.params.id);

    if (!crisisResponse) {
      return res.status(404).json({ error: 'Crisis response not found' });
    }

    if (crisisResponse.status === 'closed' || crisisResponse.status === 'resolved') {
      return res.status(400).json({ error: 'This crisis has been resolved' });
    }

    // Check if user already offered help
    const existingHelper = crisisResponse.helpers.find(
      h => h.user.toString() === req.userId
    );

    if (existingHelper) {
      return res.status(400).json({ error: 'You have already offered help' });
    }

    // Add helper
    crisisResponse.helpers.push({
      user: req.userId,
      status: 'offered',
      message: message || 'I am here to help',
      respondedAt: new Date()
    });

    await crisisResponse.save();
    await crisisResponse.populate('helpers.user', 'name profilePicture');

    // Notify the crisis creator
    const notification = new Notification({
      recipient: crisisResponse.user,
      sender: req.userId,
      type: 'crisis_help_offered',
      message: 'Someone offered to help with your crisis',
      crisisResponse: crisisResponse._id
    });
    await notification.save();

    // Send real-time update
    const io = req.app.get('io');
    const userSockets = req.app.get('userSockets');
    
    if (userSockets.has(crisisResponse.user.toString())) {
      const socketIds = userSockets.get(crisisResponse.user.toString());
      socketIds.forEach(socketId => {
        io.to(socketId).emit('crisis_help_offered', {
          crisisId: crisisResponse._id,
          helper: crisisResponse.helpers[crisisResponse.helpers.length - 1]
        });
      });
    }

    res.json({
      success: true,
      message: 'Help offer sent',
      crisisResponse
    });
  } catch (error) {
    console.error('Error offering help:', error);
    res.status(500).json({ error: 'Failed to offer help' });
  }
});

// Perform a safety check
router.post('/:id/safety-check', authenticateToken, async (req, res) => {
  try {
    const { status, message } = req.body;
    const crisisResponse = await CrisisResponse.findById(req.params.id);

    if (!crisisResponse) {
      return res.status(404).json({ error: 'Crisis response not found' });
    }

    // Add safety check
    crisisResponse.safetyChecks.push({
      checkedBy: req.userId,
      status,
      message: message || '',
      checkedAt: new Date()
    });

    // Update crisis status based on safety check
    if (status === 'safe' && crisisResponse.status === 'active') {
      crisisResponse.status = 'in_progress';
    } else if (status === 'emergency') {
      crisisResponse.severity = 'critical';
    }

    await crisisResponse.save();
    await crisisResponse.populate('safetyChecks.checkedBy', 'name profilePicture');

    // Notify relevant users
    const io = req.app.get('io');
    io.emit('crisis_safety_check', {
      crisisId: crisisResponse._id,
      safetyCheck: crisisResponse.safetyChecks[crisisResponse.safetyChecks.length - 1]
    });

    res.json({
      success: true,
      message: 'Safety check recorded',
      crisisResponse
    });
  } catch (error) {
    console.error('Error performing safety check:', error);
    res.status(500).json({ error: 'Failed to perform safety check' });
  }
});

// Add an update to the crisis
router.post('/:id/update', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    const crisisResponse = await CrisisResponse.findById(req.params.id);

    if (!crisisResponse) {
      return res.status(404).json({ error: 'Crisis response not found' });
    }

    // Only crisis creator or helpers can add updates
    const isAuthorized = 
      crisisResponse.user.toString() === req.userId ||
      crisisResponse.helpers.some(h => h.user.toString() === req.userId);

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to update this crisis' });
    }

    // Add update
    crisisResponse.updates.push({
      user: req.userId,
      message,
      timestamp: new Date()
    });

    // Extend expiration time since there's activity
    crisisResponse.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await crisisResponse.save();
    await crisisResponse.populate('updates.user', 'name profilePicture');

    // Send real-time update to all watchers
    const io = req.app.get('io');
    io.emit('crisis_update', {
      crisisId: crisisResponse._id,
      update: crisisResponse.updates[crisisResponse.updates.length - 1]
    });

    res.json({
      success: true,
      message: 'Update added',
      crisisResponse
    });
  } catch (error) {
    console.error('Error adding crisis update:', error);
    res.status(500).json({ error: 'Failed to add update' });
  }
});

// Resolve a crisis
router.post('/:id/resolve', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    const crisisResponse = await CrisisResponse.findById(req.params.id);

    if (!crisisResponse) {
      return res.status(404).json({ error: 'Crisis response not found' });
    }

    // Only crisis creator can resolve
    if (crisisResponse.user.toString() !== req.userId) {
      return res.status(403).json({ error: 'Only the crisis creator can resolve this' });
    }

    crisisResponse.status = 'resolved';
    crisisResponse.resolution = {
      message: message || 'Crisis resolved',
      resolvedBy: req.userId,
      resolvedAt: new Date()
    };

    await crisisResponse.save();

    // Notify all helpers
    for (const helper of crisisResponse.helpers) {
      const notification = new Notification({
        recipient: helper.user,
        sender: req.userId,
        type: 'crisis_resolved',
        message: 'A crisis you helped with has been resolved',
        crisisResponse: crisisResponse._id
      });
      await notification.save();
    }

    // Send real-time update
    const io = req.app.get('io');
    io.emit('crisis_resolved', {
      crisisId: crisisResponse._id,
      resolution: crisisResponse.resolution
    });

    res.json({
      success: true,
      message: 'Crisis resolved',
      crisisResponse
    });
  } catch (error) {
    console.error('Error resolving crisis:', error);
    res.status(500).json({ error: 'Failed to resolve crisis' });
  }
});

// Get user's crisis history
router.get('/user/history', authenticateToken, async (req, res) => {
  try {
    const { status, limit = 20 } = req.query;
    
    const query = { user: req.userId };
    if (status) {
      query.status = status;
    }

    const crisisHistory = await CrisisResponse.find(query)
      .populate('helpers.user', 'name profilePicture')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      count: crisisHistory.length,
      crisisHistory
    });
  } catch (error) {
    console.error('Error fetching crisis history:', error);
    res.status(500).json({ error: 'Failed to fetch crisis history' });
  }
});

// Add a resource to a crisis
router.post('/:id/resource', authenticateToken, async (req, res) => {
  try {
    const { type, name, contact, description } = req.body;
    const crisisResponse = await CrisisResponse.findById(req.params.id);

    if (!crisisResponse) {
      return res.status(404).json({ error: 'Crisis response not found' });
    }

    crisisResponse.resourcesProvided.push({
      type,
      name,
      contact,
      description,
      providedBy: req.userId,
      providedAt: new Date()
    });

    await crisisResponse.save();
    await crisisResponse.populate('resourcesProvided.providedBy', 'name profilePicture');

    // Send real-time update
    const io = req.app.get('io');
    io.emit('crisis_resource_added', {
      crisisId: crisisResponse._id,
      resource: crisisResponse.resourcesProvided[crisisResponse.resourcesProvided.length - 1]
    });

    res.json({
      success: true,
      message: 'Resource added',
      crisisResponse
    });
  } catch (error) {
    console.error('Error adding resource:', error);
    res.status(500).json({ error: 'Failed to add resource' });
  }
});

module.exports = router;
