const express = require('express');
const Poke = require('../models/Poke');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// @route   POST /api/pokes
// @desc    Send a poke to another user
// @access  Private
router.post('/', async (req, res) => {
  try {
    console.log('🤚 ==========================================');
    console.log('🤚 POST /api/pokes - Request received');
    console.log('🤚 Body:', req.body);
    console.log('🤚 User:', req.user?._id);
    
    const { recipientId, pokeType } = req.body;
    const senderId = req.user._id;

    // Validation
    if (!recipientId || !pokeType) {
      console.log('🤚 ❌ Validation failed: Missing recipientId or pokeType');
      return res.status(400).json({
        success: false,
        message: 'Recipient ID and poke type are required'
      });
    }

    // Check if poke type is valid
    const validPokeTypes = ['slap', 'kiss', 'hug', 'wave'];
    if (!validPokeTypes.includes(pokeType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid poke type. Must be one of: slap, kiss, hug, wave'
      });
    }

    // Check if trying to poke themselves
    if (senderId.toString() === recipientId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot poke yourself'
      });
    }

    // Check if recipient exists
    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: 'Recipient not found'
      });
    }

    // Create the poke
    console.log('🤚 Creating poke...');
    const poke = await Poke.create({
      sender: senderId,
      recipient: recipientId,
      pokeType
    });
    console.log('🤚 ✅ Poke created:', poke._id);

    // Populate sender info
    await poke.populate('sender', 'name avatar isOnline lastActive');
    console.log('🤚 ✅ Sender info populated');

    // Create notification
    const pokeMessages = {
      slap: 'slapped you! 👋💥',
      kiss: 'sent you a kiss! 💋😘',
      hug: 'hugged you! 🤗💕',
      wave: 'waved at you! 👋😊'
    };

    console.log('🤚 Creating notification...');
    const notification = await Notification.create({
      recipient: recipientId,
      sender: senderId,
      type: 'poke',
      message: pokeMessages[pokeType],
      pokeType,
      pokeId: poke._id
    });
    console.log('🤚 ✅ Notification created:', notification._id);

    await notification.populate('sender', 'name avatar');
    console.log('🤚 ✅ Notification sender info populated');

    // Emit Socket.IO events for real-time notification
    const io = req.app.get('io');
    console.log('🤚 Socket.IO instance:', io ? 'available' : 'not available');
    if (io) {
      const pokeEventData = {
        poke: {
          _id: poke._id,
          sender: poke.sender,
          pokeType: poke.pokeType,
          seen: poke.seen,
          responded: poke.responded,
          createdAt: poke.createdAt
        },
        notification: {
          _id: notification._id,
          sender: notification.sender,
          type: notification.type,
          message: notification.message,
          pokeType: notification.pokeType,
          isRead: notification.isRead,
          createdAt: notification.createdAt
        }
      };

      // Check if recipient is connected
      const userSockets = req.app.get('userSockets');
      const recipientSocketId = userSockets?.get(recipientId);
      console.log(`🤚 📡 Recipient socket status: ${recipientSocketId ? 'connected (' + recipientSocketId + ')' : 'not connected'}`);
      
      // Get all sockets in the recipient's room
      const roomSockets = await io.in(`user:${recipientId}`).fetchSockets();
      console.log(`🤚 📡 Sockets in room user:${recipientId}: ${roomSockets.length}`);
      roomSockets.forEach(s => console.log(`   - Socket ID: ${s.id}`));

      // Emit poke:received event
      console.log(`🤚 📤 Emitting poke:received to room: user:${recipientId}`);
      io.to(`user:${recipientId}`).emit('poke:received', pokeEventData);
      
      // Also emit notification:new event for general notification handling
      console.log(`🤚 📤 Emitting notification:new to room: user:${recipientId}`);
      io.to(`user:${recipientId}`).emit('notification:new', {
        notification: {
          _id: notification._id,
          sender: notification.sender,
          type: notification.type,
          message: notification.message,
          pokeType: notification.pokeType,
          isRead: notification.isRead,
          createdAt: notification.createdAt
        }
      });
      
      console.log('🤚 ✅ Socket events emitted successfully');
    } else {
      console.log('🤚 ⚠️ No Socket.IO instance - notification will not be sent in real-time');
    }

    console.log('🤚 ✅ Sending success response');
    console.log('🤚 ==========================================');
    
    res.status(201).json({
      success: true,
      message: `${pokeType.charAt(0).toUpperCase() + pokeType.slice(1)} sent successfully!`,
      data: {
        poke,
        notification
      }
    });
  } catch (error) {
    console.error('🤚 ❌ Send poke error:', error);
    console.error('🤚 Error stack:', error.stack);
    console.log('🤚 ==========================================');
    res.status(500).json({
      success: false,
      message: 'Failed to send poke',
      error: error.message
    });
  }
});

// @route   GET /api/pokes
// @desc    Get all pokes for current user
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, unseenOnly = false } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { recipient: req.user._id };
    if (unseenOnly === 'true') {
      query.seen = false;
    }

    const pokes = await Poke.find(query)
      .populate('sender', 'name avatar isOnline lastActive')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Poke.countDocuments(query);
    const unseenCount = await Poke.getUnseenCount(req.user._id);

    res.status(200).json({
      success: true,
      message: 'Pokes retrieved successfully',
      data: {
        pokes,
        unseenCount,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get pokes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve pokes'
    });
  }
});

// @route   GET /api/pokes/unseen-count
// @desc    Get count of unseen pokes
// @access  Private
router.get('/unseen-count', async (req, res) => {
  try {
    const count = await Poke.getUnseenCount(req.user._id);

    res.status(200).json({
      success: true,
      data: {
        unseenCount: count
      }
    });
  } catch (error) {
    console.error('Get unseen pokes count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unseen pokes count'
    });
  }
});

// @route   PATCH /api/pokes/:pokeId/seen
// @desc    Mark a poke as seen
// @access  Private
router.patch('/:pokeId/seen', async (req, res) => {
  try {
    const { pokeId } = req.params;

    const poke = await Poke.findById(pokeId);
    if (!poke) {
      return res.status(404).json({
        success: false,
        message: 'Poke not found'
      });
    }

    // Verify the poke belongs to the current user
    if (poke.recipient.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this poke'
      });
    }

    await poke.markAsSeen();

    res.status(200).json({
      success: true,
      message: 'Poke marked as seen',
      data: { poke }
    });
  } catch (error) {
    console.error('Mark poke as seen error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark poke as seen'
    });
  }
});

// @route   POST /api/pokes/:pokeId/respond
// @desc    Respond to a poke (poke back)
// @access  Private
router.post('/:pokeId/respond', async (req, res) => {
  try {
    const { pokeId } = req.params;
    const { pokeType } = req.body;

    // Validation
    if (!pokeType) {
      return res.status(400).json({
        success: false,
        message: 'Poke type is required'
      });
    }

    // Check if poke type is valid
    const validPokeTypes = ['slap', 'kiss', 'hug', 'wave'];
    if (!validPokeTypes.includes(pokeType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid poke type. Must be one of: slap, kiss, hug, wave'
      });
    }

    // Find the original poke
    const originalPoke = await Poke.findById(pokeId).populate('sender', 'name avatar');
    if (!originalPoke) {
      return res.status(404).json({
        success: false,
        message: 'Original poke not found'
      });
    }

    // Verify the poke belongs to the current user
    if (originalPoke.recipient.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to respond to this poke'
      });
    }

    // Mark original poke as responded
    await originalPoke.markAsResponded();

    // Create response poke
    const responsePoke = await Poke.create({
      sender: req.user._id,
      recipient: originalPoke.sender._id,
      pokeType
    });

    await responsePoke.populate('sender', 'name avatar isOnline lastActive');

    // Create notification for response
    const pokeMessages = {
      slap: 'slapped you back! 👋💥',
      kiss: 'sent you a kiss back! 💋😘',
      hug: 'hugged you back! 🤗💕',
      wave: 'waved back at you! 👋😊'
    };

    const notification = await Notification.create({
      recipient: originalPoke.sender._id,
      sender: req.user._id,
      type: 'poke',
      message: pokeMessages[pokeType],
      pokeType,
      pokeId: responsePoke._id
    });

    await notification.populate('sender', 'name avatar');

    // Emit Socket.IO event for real-time notification
    const io = req.app.get('io');
    if (io) {
      console.log(`📤 Emitting poke:received to user:${originalPoke.sender._id}`);
      io.to(`user:${originalPoke.sender._id}`).emit('poke:received', {
        poke: {
          _id: responsePoke._id,
          sender: responsePoke.sender,
          pokeType: responsePoke.pokeType,
          seen: responsePoke.seen,
          responded: responsePoke.responded,
          createdAt: responsePoke.createdAt
        },
        notification: {
          _id: notification._id,
          sender: notification.sender,
          type: notification.type,
          message: notification.message,
          isRead: notification.isRead,
          createdAt: notification.createdAt
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Responded to poke successfully!',
      data: {
        responsePoke,
        notification
      }
    });
  } catch (error) {
    console.error('Respond to poke error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to respond to poke',
      error: error.message
    });
  }
});

// @route   DELETE /api/pokes/:pokeId
// @desc    Delete a poke
// @access  Private
router.delete('/:pokeId', async (req, res) => {
  try {
    const { pokeId } = req.params;

    const poke = await Poke.findById(pokeId);
    if (!poke) {
      return res.status(404).json({
        success: false,
        message: 'Poke not found'
      });
    }

    // Only recipient can delete the poke
    if (poke.recipient.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this poke'
      });
    }

    await Poke.findByIdAndDelete(pokeId);

    res.status(200).json({
      success: true,
      message: 'Poke deleted successfully'
    });
  } catch (error) {
    console.error('Delete poke error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete poke'
    });
  }
});

module.exports = router;
