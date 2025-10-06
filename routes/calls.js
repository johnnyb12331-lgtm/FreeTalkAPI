const express = require('express');
const Call = require('../models/Call');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// @route   GET /api/calls/history
// @desc    Get call history for current user
// @access  Private
router.get('/history', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    const result = await Call.getCallHistory(req.user._id, { page: parseInt(page), limit: parseInt(limit) });
    
    res.status(200).json({
      success: true,
      message: 'Call history retrieved successfully',
      data: result
    });
  } catch (error) {
    console.error('Get call history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get call history'
    });
  }
});

// @route   GET /api/calls/missed
// @desc    Get missed calls count
// @access  Private
router.get('/missed', async (req, res) => {
  try {
    const count = await Call.getMissedCallsCount(req.user._id);
    
    res.status(200).json({
      success: true,
      message: 'Missed calls count retrieved successfully',
      data: { count }
    });
  } catch (error) {
    console.error('Get missed calls error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get missed calls count'
    });
  }
});

// @route   DELETE /api/calls/:callId
// @desc    Delete a call from history
// @access  Private
router.delete('/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId });
    
    if (!call) {
      return res.status(404).json({
        success: false,
        message: 'Call not found'
      });
    }
    
    // Check if user is part of the call
    if (call.caller.toString() !== req.user._id.toString() && 
        call.callee.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this call'
      });
    }
    
    await Call.deleteOne({ callId });
    
    res.status(200).json({
      success: true,
      message: 'Call deleted successfully'
    });
  } catch (error) {
    console.error('Delete call error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete call'
    });
  }
});

// @route   GET /api/calls/stats
// @desc    Get call statistics for current user
// @access  Private
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get all calls
    const totalCalls = await Call.countDocuments({
      $or: [
        { caller: userId },
        { callee: userId }
      ]
    });
    
    // Get incoming calls
    const incomingCalls = await Call.countDocuments({ callee: userId });
    
    // Get outgoing calls
    const outgoingCalls = await Call.countDocuments({ caller: userId });
    
    // Get missed calls
    const missedCalls = await Call.countDocuments({ 
      callee: userId,
      status: 'missed'
    });
    
    // Get total call duration
    const calls = await Call.find({
      $or: [
        { caller: userId },
        { callee: userId }
      ],
      status: 'ended'
    }).select('duration');
    
    const totalDuration = calls.reduce((sum, call) => sum + (call.duration || 0), 0);
    
    res.status(200).json({
      success: true,
      message: 'Call statistics retrieved successfully',
      data: {
        totalCalls,
        incomingCalls,
        outgoingCalls,
        missedCalls,
        totalDuration, // in seconds
        totalDurationFormatted: formatDuration(totalDuration)
      }
    });
  } catch (error) {
    console.error('Get call stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get call statistics'
    });
  }
});

// Helper function to format duration
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

module.exports = router;
