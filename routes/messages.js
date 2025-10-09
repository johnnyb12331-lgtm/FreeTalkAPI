const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticateToken: auth } = require('../middleware/auth');
const upload = require('../config/multer');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Notification = require('../models/Notification');
const { messageLimiter, generalLimiter, searchLimiter } = require('../middleware/rateLimiter');

// Apply general rate limiting to all message routes
router.use(generalLimiter);

// @route   GET /api/messages/conversations
// @desc    Get all conversations for the current user
// @access  Private
router.get('/conversations', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get blocked user relationships
    const Block = require('../models/Block');
    const blockedUserIds = await Block.getAllBlockRelationships(req.user._id);

    const conversations = await Conversation.find({
      participants: req.user._id,
      deletedBy: { $ne: req.user._id }
    })
      .populate('participants', 'name email avatar isOnline lastActive')
      .populate({
        path: 'lastMessage',
        select: 'content sender createdAt isRead type mediaUrl fileName fileSize'
      })
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Filter out conversations with blocked users
    const filteredConversations = conversations.filter(conv => {
      const otherParticipant = conv.participants.find(
        p => p._id.toString() !== req.user._id.toString()
      );
      return otherParticipant && !blockedUserIds.includes(otherParticipant._id.toString());
    });

    // Format conversations with other participant info or group info
    const formattedConversations = filteredConversations.map(conv => {
      if (conv.isGroup) {
        return {
          _id: conv._id,
          isGroup: true,
          groupName: conv.groupName,
          groupAvatar: conv.groupAvatar,
          groupDescription: conv.groupDescription,
          participants: conv.participants,
          admins: conv.admins,
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt,
          unreadCount: conv.getUnreadCount(req.user._id),
          isArchived: conv.archivedBy.includes(req.user._id),
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt
        };
      } else {
        const otherParticipant = conv.participants.find(
          p => p._id.toString() !== req.user._id.toString()
        );
        
        return {
          _id: conv._id,
          isGroup: false,
          otherUser: otherParticipant,
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt,
          unreadCount: conv.getUnreadCount(req.user._id),
          isArchived: conv.archivedBy.includes(req.user._id),
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt
        };
      }
    });

    // Get total unread message count
    const totalUnread = formattedConversations.reduce(
      (sum, conv) => sum + conv.unreadCount, 0
    );

    res.json({
      success: true,
      data: {
        conversations: formattedConversations,
        totalUnread,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: await Conversation.countDocuments({
            participants: req.user._id,
            deletedBy: { $ne: req.user._id }
          })
        }
      }
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversations'
    });
  }
});

// @route   GET /api/messages/conversation/:userId
// @desc    Get or create conversation with a specific user
// @access  Private
router.get('/conversation/:userId', auth, async (req, res) => {
  try {
    if (req.params.userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot create conversation with yourself'
      });
    }

    // Check if there's a block relationship
    const Block = require('../models/Block');
    const isBlocked = await Block.isBlocked(req.user._id, req.params.userId);
    
    if (isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'You cannot message this user'
      });
    }

    const conversation = await Conversation.findOrCreate(
      req.user._id,
      req.params.userId
    );

    await conversation.populate('participants', 'name email avatar');
    await conversation.populate('lastMessage', 'content sender createdAt isRead type mediaUrl fileName fileSize');

    const otherParticipant = conversation.participants.find(
      p => p._id.toString() !== req.user._id.toString()
    );

    res.json({
      success: true,
      data: {
        conversation: {
          _id: conversation._id,
          otherUser: otherParticipant,
          lastMessage: conversation.lastMessage,
          lastMessageAt: conversation.lastMessageAt,
          unreadCount: conversation.getUnreadCount(req.user._id),
          createdAt: conversation.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get conversation'
    });
  }
});

// @route   GET /api/messages/:conversationId
// @desc    Get messages in a conversation
// @access  Private
router.get('/:conversationId', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Verify user is participant
    const conversation = await Conversation.findById(req.params.conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    if (!conversation.participants.some(p => p.toString() === req.user._id.toString())) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this conversation'
      });
    }

    const messages = await Message.find({
      conversation: req.params.conversationId,
      deletedBy: { $ne: req.user._id }
    })
      .populate('sender', 'name email avatar')
      .populate('recipient', 'name email avatar')
      .populate({
        path: 'replyTo',
        select: 'content sender createdAt',
        populate: {
          path: 'sender',
          select: 'name'
        }
      })
      .populate({
        path: 'sharedStory',
        select: 'mediaType mediaUrl textContent caption backgroundColor author duration',
        populate: {
          path: 'author',
          select: 'name avatar'
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Message.countDocuments({
      conversation: req.params.conversationId,
      deletedBy: { $ne: req.user._id }
    });

    res.json({
      success: true,
      data: {
        messages: messages.reverse(), // Reverse so oldest is first
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages'
    });
  }
});

// @route   POST /api/messages
// @desc    Send a message to a user or group (text, image, or video)
// @access  Private
router.post(
  '/',
  auth,
  upload.single('media'),
  async (req, res) => {
    try {
      const { conversationId, recipient, content, replyTo, storyId, gifUrl } = req.body;
      
      // Must provide either conversationId (for groups) or recipient (for 1-on-1)
      if (!conversationId && !recipient) {
        return res.status(400).json({
          success: false,
          message: 'Conversation ID or recipient is required'
        });
      }
      
      // For text messages, content is required
      // For media messages, file is required
      // For story sharing, storyId is required
      // For GIF messages, gifUrl is required
      if (!content && !req.file && !storyId && !gifUrl) {
        return res.status(400).json({
          success: false,
          message: 'Message content, media, story, or GIF is required'
        });
      }

      let conversation;
      let isGroupMessage = false;

      // If conversationId provided, use existing conversation (group or 1-on-1)
      if (conversationId) {
        conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          return res.status(404).json({
            success: false,
            message: 'Conversation not found'
          });
        }

        // Check if user is participant
        if (!conversation.participants.some(p => p.toString() === req.user._id.toString())) {
          return res.status(403).json({
            success: false,
            message: 'You are not a participant of this conversation'
          });
        }

        isGroupMessage = conversation.isGroup;
      } else {
        // Creating/finding 1-on-1 conversation
        if (recipient === req.user._id.toString()) {
          return res.status(400).json({
            success: false,
            message: 'Cannot send message to yourself'
          });
        }

        // Check if there's a block relationship
        const Block = require('../models/Block');
        const isBlocked = await Block.isBlocked(req.user._id, recipient);
        
        if (isBlocked) {
          return res.status(403).json({
            success: false,
            message: 'You cannot send messages to this user'
          });
        }

        conversation = await Conversation.findOrCreate(req.user._id, recipient);
      }

      // Verify reply message exists if replyTo is provided
      let repliedMessage = null;
      if (replyTo) {
        repliedMessage = await Message.findById(replyTo);
        if (!repliedMessage) {
          return res.status(404).json({
            success: false,
            message: 'Replied message not found'
          });
        }
      }

      // Verify story exists if storyId is provided
      let sharedStory = null;
      if (storyId) {
        const Story = require('../models/Story');
        sharedStory = await Story.findById(storyId);
        if (!sharedStory) {
          return res.status(404).json({
            success: false,
            message: 'Story not found'
          });
        }
      }

      // Create message
      const messageData = {
        conversation: conversation._id,
        sender: req.user._id,
        content: content || ''
      };

      // For 1-on-1 messages, set recipient
      if (!isGroupMessage) {
        messageData.recipient = recipient;
      }
      
      // Handle shared story
      if (storyId && sharedStory) {
        messageData.type = 'shared_story';
        messageData.sharedStory = storyId;
      }
      // Handle GIF URL
      else if (gifUrl) {
        messageData.type = 'gif';
        messageData.gifUrl = gifUrl;
      }
      // Handle media file if uploaded
      else if (req.file) {
        console.log('🎤 Processing uploaded file:');
        console.log('   Filename:', req.file.filename);
        console.log('   Original:', req.file.originalname);
        console.log('   Mimetype:', req.file.mimetype);
        console.log('   Size:', req.file.size);
        console.log('   Duration from body:', req.body.duration);
        
        const mediaUrl = `/uploads/${req.file.filename}`;
        messageData.mediaUrl = mediaUrl;
        messageData.fileName = req.file.originalname;
        messageData.fileSize = req.file.size;
        
        // Determine media type based on mimetype
        if (req.file.mimetype.startsWith('image/')) {
          messageData.type = 'image';
          console.log('✅ Set type to: image');
        } else if (req.file.mimetype.startsWith('video/')) {
          messageData.type = 'video';
          // For videos, you could generate a thumbnail here
          // For now, we'll use the video itself as thumbnail
          messageData.thumbnail = mediaUrl;
          console.log('✅ Set type to: video');
        } else if (req.file.mimetype.startsWith('audio/')) {
          messageData.type = 'voice';
          console.log('✅ Set type to: voice');
          // Add duration if provided by client
          if (req.body.duration) {
            messageData.duration = parseFloat(req.body.duration);
            console.log('   Duration parsed:', messageData.duration);
          }
          // Add waveform data if provided by client
          if (req.body.waveformData) {
            try {
              messageData.waveformData = JSON.parse(req.body.waveformData);
              console.log('   Waveform data parsed:', messageData.waveformData.length, 'points');
            } catch (e) {
              console.error('Failed to parse waveform data:', e);
            }
          }
        } else {
          // Document type (PDF, DOC, etc.)
          messageData.type = 'document';
          console.log('✅ Set type to: document');
        }
        
        console.log('🎤 Final messageData:', {
          type: messageData.type,
          duration: messageData.duration,
          hasWaveform: !!messageData.waveformData
        });
      }
      
      // Add replyTo if provided
      if (replyTo) {
        messageData.replyTo = replyTo;
      }

      const message = await Message.create(messageData);

      // Update conversation
      conversation.lastMessage = message._id;
      conversation.lastMessageAt = message.createdAt;
      
      // Remove both sender and recipient from deletedBy array (un-delete conversation)
      // This ensures the conversation reappears for users who previously deleted it
      if (isGroupMessage) {
        // For groups, only remove the sender from deletedBy
        conversation.deletedBy = conversation.deletedBy.filter(
          id => id.toString() !== req.user._id.toString()
        );
        // Increment unread for all participants except sender
        await conversation.incrementUnreadForAll(req.user._id);
      } else {
        // For 1-on-1 chats, remove both users from deletedBy
        conversation.deletedBy = conversation.deletedBy.filter(
          id => id.toString() !== req.user._id.toString() && id.toString() !== recipient.toString()
        );
        // Increment unread for recipient only
        await conversation.incrementUnread(recipient);
      }

      // Populate message
      await message.populate('sender', 'name email avatar');
      if (message.recipient) {
        await message.populate('recipient', 'name email avatar');
      }
      
      // Populate replyTo if exists
      if (message.replyTo) {
        await message.populate({
          path: 'replyTo',
          select: 'content sender createdAt',
          populate: {
            path: 'sender',
            select: 'name'
          }
        });
      }

      // Populate sharedStory if exists
      if (message.sharedStory) {
        await message.populate({
          path: 'sharedStory',
          select: 'mediaType mediaUrl textContent caption backgroundColor author duration',
          populate: {
            path: 'author',
            select: 'name avatar'
          }
        });
      }

      // Create notifications for recipients
      const notificationMessage = storyId
        ? 'Replied to your story'
        : gifUrl
        ? 'Sent a GIF'
        : req.file 
        ? (messageData.type === 'voice' ? 'Sent a voice message' : `Sent a ${messageData.type}`)
        : (content ? content.substring(0, 100) : '');
      
      console.log(`🔔 ===== CREATING NOTIFICATION =====`);
      console.log(`🔔 Is Group Message: ${isGroupMessage}`);
      console.log(`🔔 Notification Message: ${notificationMessage}`);
      
      if (isGroupMessage) {
        // Create notification for all group members except sender
        const notificationPromises = conversation.participants
          .filter(participantId => participantId.toString() !== req.user._id.toString())
          .map(participantId => {
            console.log(`🔔 Creating notification for group participant: ${participantId}`);
            return Notification.create({
              recipient: participantId,
              sender: req.user._id,
              type: 'message',
              message: `${req.user.name} in ${conversation.groupName}: ${notificationMessage}`,
              conversation: conversation._id
            });
          });
        await Promise.all(notificationPromises);
        console.log(`🔔 Created ${notificationPromises.length} notifications for group members`);
      } else {
        // Create notification for single recipient
        console.log(`🔔 Creating notification for recipient: ${recipient}`);
        const notification = await Notification.create({
          recipient,
          sender: req.user._id,
          type: 'message',
          message: notificationMessage,
          conversation: conversation._id
        });
        console.log(`🔔 Notification created successfully with ID: ${notification._id}`);
      }
      console.log(`🔔 ===== NOTIFICATION CREATED =====`);

      // Emit Socket.IO events
      const io = req.app.get('io');
      if (io) {
        const socketMessageData = {
          _id: message._id,
          conversation: conversation._id,
          sender: {
            _id: req.user._id,
            name: req.user.name,
            avatar: req.user.avatar
          },
          recipient: message.recipient,
          content: message.content,
          type: message.type,
          mediaUrl: message.mediaUrl,
          thumbnail: message.thumbnail,
          gifUrl: message.gifUrl,
          duration: message.duration, // Voice message duration
          waveformData: message.waveformData, // Voice message waveform
          fileName: message.fileName,
          fileSize: message.fileSize,
          isGroup: isGroupMessage,
          groupName: isGroupMessage ? conversation.groupName : null,
          replyTo: message.replyTo ? {
            _id: message.replyTo._id,
            content: message.replyTo.content,
            sender: message.replyTo.sender,
            createdAt: message.replyTo.createdAt
          } : null,
          sharedStory: message.sharedStory ? {
            _id: message.sharedStory._id,
            mediaType: message.sharedStory.mediaType,
            mediaUrl: message.sharedStory.mediaUrl,
            textContent: message.sharedStory.textContent,
            backgroundColor: message.sharedStory.backgroundColor,
            author: message.sharedStory.author
          } : null,
          isRead: false,
          createdAt: message.createdAt
        };

        if (isGroupMessage) {
          // Send to all group participants
          console.log(`💬 =====================================`);
          console.log(`💬 Sending group message to ${conversation.participants.length} participants`);
          conversation.participants.forEach(participantId => {
            console.log(`💬 Emitting message:new to user:${participantId}`);
            io.to(`user:${participantId}`).emit('message:new', {
              message: socketMessageData
            });

            // Send unread count update to all except sender
            if (participantId.toString() !== req.user._id.toString()) {
              const participantUnreadCount = conversation.getUnreadCount(participantId);
              console.log(`💬 Emitting unread count ${participantUnreadCount} to user:${participantId}`);
              io.to(`user:${participantId}`).emit('message:unread-count', {
                conversationId: conversation._id.toString(),
                unreadCount: participantUnreadCount,
                increment: 1
              });

              // Send notification
              // Note: Message count increment is handled by 'message:unread-count' event above
              console.log(`💬 Emitting notification:new to user:${participantId}`);
              io.to(`user:${participantId}`).emit('notification:new', {
                notification: {
                  _id: message._id,
                  type: 'message',
                  sender: {
                    _id: req.user._id,
                    name: req.user.name,
                    avatar: req.user.avatar
                  },
                  message: `${req.user.name} in ${conversation.groupName}: ${notificationMessage}`,
                  conversation: conversation._id,
                  read: false,
                  createdAt: message.createdAt
                }
              });
            }
          });
          console.log(`💬 =====================================`);
        } else {
          // Send to 1-on-1 recipient and sender
          console.log(`💬 =====================================`);
          console.log(`💬 1-ON-1 MESSAGE BEING SENT`);
          console.log(`💬 From: ${req.user._id} (${req.user.name})`);
          console.log(`💬 To: ${recipient}`);
          console.log(`💬 Conversation: ${conversation._id}`);
          console.log(`💬 Message ID: ${message._id}`);
          
          // Check if recipient is connected via socket
          const userSockets = req.app.get('userSockets');
          const recipientSockets = userSockets?.get(recipient);
          console.log(`💬 Recipient socket connections:`, recipientSockets ? Array.from(recipientSockets) : 'NOT CONNECTED');
          
          // Check what rooms the recipient sockets are in
          if (recipientSockets && recipientSockets.size > 0) {
            recipientSockets.forEach(socketId => {
              const socket = io.sockets.sockets.get(socketId);
              if (socket) {
                const rooms = Array.from(socket.rooms);
                console.log(`💬 Socket ${socketId} is in rooms:`, rooms);
              }
            });
          }
          
          console.log(`💬 Emitting message:new to recipient room: user:${recipient}`);
          io.to(`user:${recipient}`).emit('message:new', {
            message: socketMessageData
          });

          // ALSO send to sender's room so they see it in real-time
          console.log(`💬 Emitting message:new to sender room: user:${req.user._id}`);
          io.to(`user:${req.user._id}`).emit('message:new', {
            message: socketMessageData
          });

          // Get updated unread count for recipient
          const recipientUnreadCount = conversation.getUnreadCount(recipient);
          console.log(`💬 Recipient unread count after increment: ${recipientUnreadCount}`);

          // Send unread count update to recipient
          console.log(`💬 Emitting message:unread-count to recipient: user:${recipient}`);
          io.to(`user:${recipient}`).emit('message:unread-count', {
            conversationId: conversation._id.toString(),
            unreadCount: recipientUnreadCount,
            increment: 1
          });

          // Send notification to recipient only (not sender)
          // Note: Message count increment is handled by 'message:unread-count' event above
          console.log(`💬 ===== EMITTING NOTIFICATION =====`);
          console.log(`💬 Event: notification:new`);
          console.log(`💬 Target room: user:${recipient}`);
          console.log(`💬 Notification data:`, {
            _id: message._id,
            type: 'message',
            sender: {
              _id: req.user._id,
              name: req.user.name,
              avatar: req.user.avatar
            },
            message: notificationMessage,
            conversation: conversation._id,
            read: false,
            createdAt: message.createdAt
          });
          
          io.to(`user:${recipient}`).emit('notification:new', {
            notification: {
              _id: message._id,
              type: 'message',
              sender: {
                _id: req.user._id,
                name: req.user.name,
                avatar: req.user.avatar
              },
              message: notificationMessage,
              conversation: conversation._id,
              read: false,
              createdAt: message.createdAt
            }
          });
          console.log(`💬 ===== NOTIFICATION EMITTED =====`);
          console.log(`💬 =====================================`);
        }

        console.log(`✅ Message sent successfully with notifications and unread count updated`);
      }

      res.status(201).json({
        success: true,
        message: 'Message sent successfully',
        data: { message }
      });
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send message',
        error: error.message
      });
    }
  }
);

// @route   PATCH /api/messages/:conversationId/read
// @desc    Mark all messages in conversation as read
// @access  Private
router.patch('/:conversationId/read', auth, async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // Verify user is participant
    if (!conversation.participants.some(p => p.toString() === req.user._id.toString())) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Mark all unread messages as read
    await Message.updateMany(
      {
        conversation: req.params.conversationId,
        recipient: req.user._id,
        isRead: false
      },
      {
        $set: {
          isRead: true,
          readAt: new Date()
        }
      }
    );

    // Get the count BEFORE resetting to know how much to decrement
    const unreadCountBeforeReset = conversation.getUnreadCount(req.user._id);
    
    // Reset unread count
    await conversation.resetUnread(req.user._id);

    // Emit Socket.IO event to sender (to show checkmarks)
    const otherUserId = conversation.getOtherParticipant(req.user._id);
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${otherUserId}`).emit('messages:read', {
        conversationId: conversation._id,
        readBy: req.user._id
      });
      
      // IMPORTANT: Emit to current user to update their unread count badge
      // Send negative increment to decrease the count
      console.log(`📬 Sending unread count update to user:${req.user._id} - decrement by ${unreadCountBeforeReset}`);
      io.to(`user:${req.user._id}`).emit('message:unread-count', {
        conversationId: conversation._id.toString(),
        unreadCount: 0,
        increment: -unreadCountBeforeReset
      });
    }

    res.json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read'
    });
  }
});

// @route   POST /api/messages/typing
// @desc    Emit typing indicator to other user
// @access  Private
router.post('/typing', auth, async (req, res) => {
  try {
    const { conversationId, isTyping } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: 'Conversation ID is required'
      });
    }

    // Verify user is participant
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    if (!conversation.participants.some(p => p.toString() === req.user._id.toString())) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Get the other user
    const otherUserId = conversation.getOtherParticipant(req.user._id);

    // Emit typing event to the other user
    const io = req.app.get('io');
    if (io) {
      const eventName = isTyping ? 'typing:start' : 'typing:stop';
      console.log(`⌨️ Emitting ${eventName} to user:${otherUserId} in conversation ${conversationId}`);
      
      io.to(`user:${otherUserId}`).emit(eventName, {
        conversationId: conversationId,
        userId: req.user._id.toString(),
        userName: req.user.name
      });
    }

    res.json({
      success: true,
      message: 'Typing status updated'
    });
  } catch (error) {
    console.error('Typing indicator error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update typing status'
    });
  }
});

// @route   DELETE /api/messages/:messageId/for-me
// @desc    Delete a message for current user only (soft delete)
// @access  Private
router.delete('/:messageId/for-me', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Verify user is sender or recipient
    if (
      message.sender.toString() !== req.user._id.toString() &&
      message.recipient.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this message'
      });
    }

    // Soft delete for current user only
    await message.deleteForUser(req.user._id);

    console.log(`🗑️ Message ${message._id} deleted for user ${req.user._id}`);

    res.json({
      success: true,
      message: 'Message deleted for you'
    });
  } catch (error) {
    console.error('Delete message for me error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message'
    });
  }
});

// @route   DELETE /api/messages/:messageId/for-everyone
// @desc    Delete a message for everyone (only sender can do this)
// @access  Private
router.delete('/:messageId/for-everyone', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Only the sender can delete for everyone
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the sender can delete this message for everyone'
      });
    }

    // Check if message is older than 1 hour (optional time limit)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (message.createdAt < oneHourAgo) {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete messages older than 1 hour for everyone'
      });
    }

    // Mark as deleted for everyone
    message.content = 'This message was deleted';
    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    console.log(`🗑️ Message ${message._id} deleted for everyone by ${req.user._id}`);

    // Emit socket event to both users
    const io = req.app.get('io');
    if (io) {
      const updateData = {
        messageId: message._id.toString(),
        conversationId: message.conversation.toString(),
        content: message.content,
        isDeleted: true
      };

      // Emit to recipient
      io.to(`user:${message.recipient}`).emit('message:deleted', updateData);
      
      // Emit to sender
      io.to(`user:${message.sender}`).emit('message:deleted', updateData);
    }

    res.json({
      success: true,
      message: 'Message deleted for everyone',
      data: {
        messageId: message._id,
        content: message.content,
        isDeleted: true
      }
    });
  } catch (error) {
    console.error('Delete message for everyone error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message'
    });
  }
});

// @route   DELETE /api/messages/:messageId (kept for backward compatibility)
// @desc    Delete a message (soft delete for current user)
// @access  Private
router.delete('/:messageId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Verify user is sender or recipient
    if (
      message.sender.toString() !== req.user._id.toString() &&
      message.recipient.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this message'
      });
    }

    await message.deleteForUser(req.user._id);

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message'
    });
  }
});

// @route   DELETE /api/messages/conversation/:conversationId/clear
// @desc    Clear all messages in a conversation for current user (soft delete)
// @access  Private
router.delete('/conversation/:conversationId/clear', auth, async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // Verify user is a participant
    if (!conversation.participants.some(p => p.toString() === req.user._id.toString())) {
      return res.status(403).json({
        success: false,
        message: 'You are not a participant of this conversation'
      });
    }

    // Find all messages in this conversation
    const messages = await Message.find({
      conversation: req.params.conversationId
    });

    // Add current user to deletedBy array for each message (if not already there)
    let clearedCount = 0;
    for (const message of messages) {
      if (!message.deletedBy.includes(req.user._id)) {
        message.deletedBy.push(req.user._id);
        await message.save();
        clearedCount++;
      }
    }

    console.log(`🗑️ Cleared ${clearedCount} messages for user ${req.user._id} in conversation ${conversation._id}`);

    res.json({
      success: true,
      message: `Cleared ${clearedCount} messages`,
      data: {
        clearedCount
      }
    });
  } catch (error) {
    console.error('Clear messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear messages'
    });
  }
});

// @route   POST /api/messages/:messageId/react
// @desc    Add or update reaction to a message
// @access  Private
router.post('/:messageId/react', auth, async (req, res) => {
  try {
    const { emoji } = req.body;

    if (!emoji || typeof emoji !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Emoji is required'
      });
    }

    const message = await Message.findById(req.params.messageId)
      .populate('sender', 'name email avatar')
      .populate('recipient', 'name email avatar');

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user is part of the conversation
    if (
      message.sender._id.toString() !== req.user._id.toString() &&
      message.recipient._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to react to this message'
      });
    }

    // Check if user already reacted
    const existingReactionIndex = message.reactions.findIndex(
      r => r.user.toString() === req.user._id.toString()
    );

    if (existingReactionIndex !== -1) {
      // Update existing reaction
      message.reactions[existingReactionIndex].emoji = emoji;
      message.reactions[existingReactionIndex].createdAt = new Date();
    } else {
      // Add new reaction
      message.reactions.push({
        user: req.user._id,
        emoji,
        createdAt: new Date()
      });
    }

    await message.save();

    // Populate the user info in reactions
    await message.populate('reactions.user', 'name email avatar');

    // Send socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      const otherUserId = message.sender._id.toString() === req.user._id.toString()
        ? message.recipient._id.toString()
        : message.sender._id.toString();

      // Emit to both users in the conversation
      io.to(`user:${req.user._id}`).emit('message:reacted', {
        messageId: message._id,
        conversationId: message.conversation,
        reaction: {
          user: {
            _id: req.user._id,
            name: req.user.name,
            avatar: req.user.avatar
          },
          emoji,
          createdAt: new Date()
        },
        reactions: message.reactions
      });

      io.to(`user:${otherUserId}`).emit('message:reacted', {
        messageId: message._id,
        conversationId: message.conversation,
        reaction: {
          user: {
            _id: req.user._id,
            name: req.user.name,
            avatar: req.user.avatar
          },
          emoji,
          createdAt: new Date()
        },
        reactions: message.reactions
      });

      // Create notification for the message sender (if not reacting to own message)
      if (message.sender._id.toString() !== req.user._id.toString()) {
        try {
          const notification = await Notification.create({
            recipient: message.sender._id,
            sender: req.user._id,
            type: 'message_reaction',
            message: message._id
          });

          await notification.populate('sender', 'name email avatar');

          io.to(`user:${message.sender._id}`).emit('notification:new', {
            notification: notification.toJSON()
          });

          console.log(`📡 Sent message reaction notification to user ${message.sender._id}`);
        } catch (notifError) {
          console.error('Error creating reaction notification:', notifError);
        }
      }

      console.log(`📡 Emitted message:reacted for message ${message._id}`);
    }

    res.json({
      success: true,
      message: 'Reaction added successfully',
      data: {
        reactions: message.reactions
      }
    });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reaction'
    });
  }
});

// @route   DELETE /api/messages/:messageId/react
// @desc    Remove reaction from a message
// @access  Private
router.delete('/:messageId/react', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user is part of the conversation
    if (
      message.sender.toString() !== req.user._id.toString() &&
      message.recipient.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to unreact to this message'
      });
    }

    // Remove user's reaction
    message.reactions = message.reactions.filter(
      r => r.user.toString() !== req.user._id.toString()
    );

    await message.save();

    // Populate the user info in reactions
    await message.populate('reactions.user', 'name email avatar');

    // Send socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      const otherUserId = message.sender.toString() === req.user._id.toString()
        ? message.recipient.toString()
        : message.sender.toString();

      // Emit to both users in the conversation
      io.to(`user:${req.user._id}`).emit('message:unreacted', {
        messageId: message._id,
        conversationId: message.conversation,
        userId: req.user._id,
        reactions: message.reactions
      });

      io.to(`user:${otherUserId}`).emit('message:unreacted', {
        messageId: message._id,
        conversationId: message.conversation,
        userId: req.user._id,
        reactions: message.reactions
      });

      console.log(`📡 Emitted message:unreacted for message ${message._id}`);
    }

    res.json({
      success: true,
      message: 'Reaction removed successfully',
      data: {
        reactions: message.reactions
      }
    });
  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove reaction'
    });
  }
});

// @route   DELETE /api/messages/conversation/:conversationId
// @desc    Delete (hide) a conversation for the current user
// @access  Private
router.delete('/conversation/:conversationId', auth, async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // Check if user is a participant
    if (!conversation.participants.includes(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this conversation'
      });
    }

    // Add user to deletedBy array
    if (!conversation.deletedBy.includes(req.user._id)) {
      conversation.deletedBy.push(req.user._id);
    }

    // If both users deleted, actually delete the conversation and all messages
    if (conversation.deletedBy.length >= 2) {
      // Delete all messages in this conversation
      await Message.deleteMany({ conversation: conversation._id });
      
      // Delete the conversation
      await Conversation.findByIdAndDelete(conversation._id);
      
      console.log(`🗑️ Permanently deleted conversation ${conversation._id} and all messages`);
    } else {
      // Just mark as deleted for this user
      await conversation.save();
      console.log(`🗑️ User ${req.user._id} deleted conversation ${conversation._id}`);
    }

    res.json({
      success: true,
      message: 'Conversation deleted successfully'
    });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete conversation'
    });
  }
});

// ==================== GROUP CHAT ENDPOINTS ====================

// @route   POST /api/messages/groups
// @desc    Create a new group chat
// @access  Private
router.post('/groups', [
  auth,
  body('groupName').trim().notEmpty().withMessage('Group name is required'),
  body('participants').isArray({ min: 2 }).withMessage('At least 2 participants required'),
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

    const { groupName, groupDescription, participants } = req.body;
    
    // Add creator to participants if not already included
    const allParticipants = [...new Set([req.user._id.toString(), ...participants])];
    
    if (allParticipants.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Group must have at least 3 participants (including you)'
      });
    }

    // Initialize unread count for all participants
    const unreadCount = {};
    allParticipants.forEach(participantId => {
      unreadCount[participantId] = 0;
    });

    // Create group conversation
    const conversation = await Conversation.create({
      isGroup: true,
      groupName,
      groupDescription: groupDescription || '',
      participants: allParticipants,
      admins: [req.user._id], // Creator is the first admin
      createdBy: req.user._id,
      unreadCount
    });

    await conversation.populate('participants', 'name email avatar isOnline lastActive');
    await conversation.populate('admins', 'name email avatar');

    // Emit Socket.IO event to all participants
    const io = req.app.get('io');
    if (io) {
      allParticipants.forEach(participantId => {
        if (participantId !== req.user._id.toString()) {
          io.to(`user:${participantId}`).emit('group:created', {
            conversation: conversation.toObject()
          });
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: { conversation }
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create group'
    });
  }
});

// @route   PUT /api/messages/groups/:conversationId
// @desc    Update group info (name, description, avatar)
// @access  Private (Admin only)
router.put('/groups/:conversationId', auth, upload.single('avatar'), async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    if (!conversation.isGroup) {
      return res.status(400).json({
        success: false,
        message: 'This is not a group conversation'
      });
    }

    // Check if user is admin
    if (!conversation.isAdmin(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update group info'
      });
    }

    const { groupName, groupDescription } = req.body;

    if (groupName) conversation.groupName = groupName;
    if (groupDescription !== undefined) conversation.groupDescription = groupDescription;
    if (req.file) {
      conversation.groupAvatar = `/uploads/${req.file.filename}`;
    }

    await conversation.save();
    await conversation.populate('participants', 'name email avatar isOnline lastActive');
    await conversation.populate('admins', 'name email avatar');

    // Emit Socket.IO event to all participants
    const io = req.app.get('io');
    if (io) {
      conversation.participants.forEach(participant => {
        io.to(`user:${participant._id}`).emit('group:updated', {
          conversationId: conversation._id,
          groupName: conversation.groupName,
          groupDescription: conversation.groupDescription,
          groupAvatar: conversation.groupAvatar
        });
      });
    }

    res.json({
      success: true,
      message: 'Group updated successfully',
      data: { conversation }
    });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update group'
    });
  }
});

// @route   POST /api/messages/groups/:conversationId/participants
// @desc    Add participants to group
// @access  Private (Admin only)
router.post('/groups/:conversationId/participants', [
  auth,
  body('participantIds').isArray({ min: 1 }).withMessage('At least 1 participant ID required'),
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

    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    if (!conversation.isGroup) {
      return res.status(400).json({
        success: false,
        message: 'This is not a group conversation'
      });
    }

    // Check if user is admin
    if (!conversation.isAdmin(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can add participants'
      });
    }

    const { participantIds } = req.body;
    const addedParticipants = [];

    for (const participantId of participantIds) {
      if (!conversation.participants.some(p => p.toString() === participantId)) {
        await conversation.addParticipant(participantId);
        addedParticipants.push(participantId);
      }
    }

    await conversation.populate('participants', 'name email avatar isOnline lastActive');
    await conversation.populate('admins', 'name email avatar');

    // Emit Socket.IO event to all participants
    const io = req.app.get('io');
    if (io) {
      conversation.participants.forEach(participant => {
        io.to(`user:${participant._id}`).emit('group:participant-added', {
          conversationId: conversation._id,
          participants: conversation.participants,
          addedParticipants
        });
      });
    }

    res.json({
      success: true,
      message: 'Participants added successfully',
      data: { conversation, addedParticipants }
    });
  } catch (error) {
    console.error('Add participants error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add participants'
    });
  }
});

// @route   DELETE /api/messages/groups/:conversationId/participants/:participantId
// @desc    Remove participant from group
// @access  Private (Admin only or self)
router.delete('/groups/:conversationId/participants/:participantId', auth, async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    if (!conversation.isGroup) {
      return res.status(400).json({
        success: false,
        message: 'This is not a group conversation'
      });
    }

    const { participantId } = req.params;
    const isRemovingSelf = participantId === req.user._id.toString();
    const isAdmin = conversation.isAdmin(req.user._id);

    // Check permissions: admins can remove anyone, users can only remove themselves
    if (!isRemovingSelf && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can remove other participants'
      });
    }

    // Don't allow removing the last admin
    if (conversation.isAdmin(participantId) && conversation.admins.length === 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove the last admin. Assign another admin first.'
      });
    }

    await conversation.removeParticipant(participantId);
    await conversation.populate('participants', 'name email avatar isOnline lastActive');
    await conversation.populate('admins', 'name email avatar');

    // Emit Socket.IO event to all participants
    const io = req.app.get('io');
    if (io) {
      conversation.participants.forEach(participant => {
        io.to(`user:${participant._id}`).emit('group:participant-removed', {
          conversationId: conversation._id,
          removedParticipantId: participantId,
          participants: conversation.participants
        });
      });
      
      // Also notify the removed participant
      io.to(`user:${participantId}`).emit('group:removed', {
        conversationId: conversation._id
      });
    }

    res.json({
      success: true,
      message: isRemovingSelf ? 'Left group successfully' : 'Participant removed successfully',
      data: { conversation }
    });
  } catch (error) {
    console.error('Remove participant error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove participant'
    });
  }
});

// @route   POST /api/messages/groups/:conversationId/admins/:participantId
// @desc    Make a participant an admin
// @access  Private (Admin only)
router.post('/groups/:conversationId/admins/:participantId', auth, async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    if (!conversation.isGroup) {
      return res.status(400).json({
        success: false,
        message: 'This is not a group conversation'
      });
    }

    if (!conversation.isAdmin(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can promote others to admin'
      });
    }

    const { participantId } = req.params;

    if (!conversation.participants.some(p => p.toString() === participantId)) {
      return res.status(400).json({
        success: false,
        message: 'User is not a participant of this group'
      });
    }

    await conversation.addAdmin(participantId);
    await conversation.populate('participants', 'name email avatar isOnline lastActive');
    await conversation.populate('admins', 'name email avatar');

    // Emit Socket.IO event to all participants
    const io = req.app.get('io');
    if (io) {
      conversation.participants.forEach(participant => {
        io.to(`user:${participant._id}`).emit('group:admin-added', {
          conversationId: conversation._id,
          newAdminId: participantId,
          admins: conversation.admins
        });
      });
    }

    res.json({
      success: true,
      message: 'Admin added successfully',
      data: { conversation }
    });
  } catch (error) {
    console.error('Add admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add admin'
    });
  }
});

// @route   DELETE /api/messages/groups/:conversationId/admins/:participantId
// @desc    Remove admin status from a participant
// @access  Private (Admin only)
router.delete('/groups/:conversationId/admins/:participantId', auth, async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    if (!conversation.isGroup) {
      return res.status(400).json({
        success: false,
        message: 'This is not a group conversation'
      });
    }

    if (!conversation.isAdmin(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can remove admin status'
      });
    }

    const { participantId } = req.params;

    // Don't allow removing the last admin
    if (conversation.admins.length === 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove the last admin'
      });
    }

    await conversation.removeAdmin(participantId);
    await conversation.populate('participants', 'name email avatar isOnline lastActive');
    await conversation.populate('admins', 'name email avatar');

    // Emit Socket.IO event to all participants
    const io = req.app.get('io');
    if (io) {
      conversation.participants.forEach(participant => {
        io.to(`user:${participant._id}`).emit('group:admin-removed', {
          conversationId: conversation._id,
          removedAdminId: participantId,
          admins: conversation.admins
        });
      });
    }

    res.json({
      success: true,
      message: 'Admin removed successfully',
      data: { conversation }
    });
  } catch (error) {
    console.error('Remove admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove admin'
    });
  }
});

// @route   GET /api/messages/:conversationId/search
// @desc    Search messages within a conversation
// @access  Private
router.get('/:conversationId/search', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { query, page = 1, limit = 20 } = req.query;

    if (!query || query.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    // Verify conversation exists and user is a participant
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    if (!conversation.participants.includes(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to access this conversation'
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Search messages using text index (case-insensitive)
    const searchResults = await Message.find({
      conversation: conversationId,
      deletedBy: { $ne: req.user._id },
      isDeleted: false,
      $text: { $search: query }
    })
      .populate('sender', 'name email avatar')
      .populate('replyTo', 'content sender')
      .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalResults = await Message.countDocuments({
      conversation: conversationId,
      deletedBy: { $ne: req.user._id },
      isDeleted: false,
      $text: { $search: query }
    });

    res.json({
      success: true,
      data: {
        results: searchResults,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalResults,
          totalPages: Math.ceil(totalResults / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search messages'
    });
  }
});

// @route   GET /api/messages/:conversationId/export
// @desc    Export conversation history
// @access  Private
router.get('/:conversationId/export', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { format = 'json' } = req.query; // json or txt

    // Verify conversation exists and user is a participant
    const conversation = await Conversation.findById(conversationId)
      .populate('participants', 'name email avatar');

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    if (!conversation.participants.some(p => p._id.toString() === req.user._id.toString())) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to access this conversation'
      });
    }

    // Get all messages in the conversation (not deleted by user)
    const messages = await Message.find({
      conversation: conversationId,
      deletedBy: { $ne: req.user._id },
      isDeleted: false
    })
      .populate('sender', 'name email avatar')
      .populate('replyTo', 'content sender')
      .sort({ createdAt: 1 }); // Chronological order

    // Get other participant info for file naming
    const otherParticipant = conversation.isGroup 
      ? { name: conversation.groupName || 'Group Chat' }
      : conversation.participants.find(p => p._id.toString() !== req.user._id.toString());

    const fileName = `FreeTalk_${otherParticipant.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}`;

    if (format === 'txt') {
      // Generate plain text format
      let textContent = `FreeTalk Conversation Export\n`;
      textContent += `===============================\n\n`;
      textContent += `Chat with: ${otherParticipant.name}\n`;
      textContent += `Exported on: ${new Date().toLocaleString()}\n`;
      textContent += `Total messages: ${messages.length}\n`;
      textContent += `\n===============================\n\n`;

      messages.forEach(msg => {
        const timestamp = new Date(msg.createdAt).toLocaleString();
        const senderName = msg.sender.name || 'Unknown';
        
        textContent += `[${timestamp}] ${senderName}:\n`;
        
        if (msg.replyTo) {
          const replyToSender = msg.replyTo.sender?.name || 'Unknown';
          textContent += `  ↳ Replying to ${replyToSender}: "${msg.replyTo.content || '[Media]'}"\n`;
        }
        
        if (msg.content) {
          textContent += `  ${msg.content}\n`;
        }
        
        if (msg.type === 'image') {
          textContent += `  📷 [Image: ${msg.mediaUrl}]\n`;
        } else if (msg.type === 'video') {
          textContent += `  🎥 [Video: ${msg.mediaUrl}]\n`;
        } else if (msg.type === 'document') {
          textContent += `  📄 [Document: ${msg.fileName || msg.mediaUrl}]\n`;
        } else if (msg.type === 'gif') {
          textContent += `  🎬 [GIF: ${msg.mediaUrl}]\n`;
        }
        
        if (msg.reactions && msg.reactions.length > 0) {
          const reactionSummary = msg.reactions.map(r => `${r.emoji}(${r.user.name})`).join(', ');
          textContent += `  Reactions: ${reactionSummary}\n`;
        }
        
        textContent += `\n`;
      });

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}.txt"`);
      res.send(textContent);
    } else {
      // Generate JSON format
      const exportData = {
        exportInfo: {
          exportedBy: req.user.name,
          exportedAt: new Date().toISOString(),
          conversationId: conversationId,
          totalMessages: messages.length
        },
        conversation: {
          isGroup: conversation.isGroup,
          name: conversation.isGroup ? conversation.groupName : otherParticipant.name,
          participants: conversation.participants.map(p => ({
            id: p._id,
            name: p.name,
            email: p.email
          }))
        },
        messages: messages.map(msg => ({
          id: msg._id,
          sender: {
            id: msg.sender._id,
            name: msg.sender.name,
            email: msg.sender.email
          },
          content: msg.content,
          type: msg.type,
          mediaUrl: msg.mediaUrl,
          fileName: msg.fileName,
          fileSize: msg.fileSize,
          replyTo: msg.replyTo ? {
            id: msg.replyTo._id,
            content: msg.replyTo.content,
            sender: msg.replyTo.sender?.name
          } : null,
          reactions: msg.reactions,
          isRead: msg.isRead,
          createdAt: msg.createdAt,
          updatedAt: msg.updatedAt
        }))
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}.json"`);
      res.json({
        success: true,
        data: exportData
      });
    }
  } catch (error) {
    console.error('Export conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export conversation'
    });
  }
});

module.exports = router;
