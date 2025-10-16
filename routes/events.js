const express = require('express');
const { body, validationResult, query, param } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const checkSuspension = require('../middleware/checkSuspension');
const { generalLimiter, createContentLimiter, searchLimiter } = require('../middleware/rateLimiter');
const Event = require('../models/Event');
const Notification = require('../models/Notification');

const router = express.Router();

// All event routes require auth
router.use(authenticateToken);
router.use(generalLimiter);

const createEventValidation = [
  body('title').trim().notEmpty().isLength({ max: 140 }),
  body('description').optional().isLength({ max: 5000 }),
  body('startTime').notEmpty().isISO8601().toDate(),
  body('endTime').optional({ nullable: true }).isISO8601().toDate(),
  body('visibility').optional().isIn(['public', 'friends', 'private']),
  body('isAllDay').optional().isBoolean(),
  body('timezone').optional().isString(),
  body('locationName').optional().isString(),
  body('locationAddress').optional().isString(),
  body('latitude').optional({ nullable: true }).isFloat({ min: -90, max: 90 }),
  body('longitude').optional({ nullable: true }).isFloat({ min: -180, max: 180 }),
  body('tags').optional().isArray({ max: 20 })
];

// Create event
router.post('/', createContentLimiter, checkSuspension, createEventValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const data = {
      title: req.body.title,
      description: req.body.description || '',
      organizer: req.user._id,
      startTime: req.body.startTime,
      endTime: req.body.endTime || null,
      timezone: req.body.timezone || 'UTC',
      isAllDay: !!req.body.isAllDay,
      visibility: req.body.visibility || 'public',
      coverImage: req.body.coverImage || null,
      capacity: req.body.capacity || null,
      allowGuests: req.body.allowGuests !== undefined ? !!req.body.allowGuests : true,
      tags: req.body.tags || [],
      locationName: req.body.locationName || null,
      locationAddress: req.body.locationAddress || null,
      latitude: req.body.latitude || null,
      longitude: req.body.longitude || null
    };

    const event = await Event.create(data);

    // Emit realtime event to followers of organizer (basic: to organizer's room)
    const io = req.app.get('io');
    io.to(`user:${req.user._id.toString()}`).emit('event:created', { eventId: event._id.toString(), event });

    return res.status(201).json({ success: true, data: event });
  } catch (error) {
    console.error('Create event error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create event' });
  }
});

// Get my events (organized or attending)
router.get('/mine', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const events = await Event.find({
      $or: [
        { organizer: req.user._id },
        { 'rsvps.user': req.user._id }
      ]
    })
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Event.countDocuments({
      $or: [
        { organizer: req.user._id },
        { 'rsvps.user': req.user._id }
      ]
    });

    return res.json({ success: true, data: { events, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) {
    console.error('Get my events error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch events' });
  }
});

// Event by id
// Discover events (place before :id route to avoid conflicts)
router.get('/discover/list', searchLimiter, [
  query('q').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('from').optional().isISO8601().toDate(),
  query('to').optional().isISO8601().toDate(),
  query('visibility').optional().isIn(['public', 'friends'])
], async (req, res) => {
  try {
    const { q, page = 1, limit = 20, from, to, visibility } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const filter = { };
    if (visibility) filter.visibility = visibility;
    else filter.visibility = 'public';

    if (from || to) {
      filter.startTime = {};
      if (from) filter.startTime.$gte = from;
      if (to) filter.startTime.$lte = to;
    } else {
      // Default: upcoming from now
      filter.startTime = { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }; // include a small buffer into the past
    }

    if (q && q.trim().length) {
      filter.$text = { $search: q.trim() };
    }

    const events = await Event.find(filter)
      .sort({ startTime: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-invitations');

    const total = await Event.countDocuments(filter);
    return res.json({ success: true, data: { events, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) {
    console.error('Discover events error:', error);
    return res.status(500).json({ success: false, message: 'Failed to discover events' });
  }
});

// Event by id
router.get('/:id', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).populate('organizer', 'name avatar').populate('rsvps.user', 'name avatar').populate('invitations.user', 'name avatar');
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

    // Visibility checks for private/friends could be enhanced with actual relationships
    return res.json({ success: true, data: event });
  } catch (error) {
    console.error('Get event error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch event' });
  }
});

// Update event (organizer only)
router.put('/:id', checkSuspension, createEventValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (event.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the organizer can update the event' });
    }

    Object.assign(event, {
      title: req.body.title,
      description: req.body.description || '',
      startTime: req.body.startTime,
      endTime: req.body.endTime || null,
      timezone: req.body.timezone || 'UTC',
      isAllDay: !!req.body.isAllDay,
      visibility: req.body.visibility || 'public',
      coverImage: req.body.coverImage || null,
      capacity: req.body.capacity || null,
      allowGuests: req.body.allowGuests !== undefined ? !!req.body.allowGuests : event.allowGuests,
      tags: req.body.tags || [],
      locationName: req.body.locationName || null,
      locationAddress: req.body.locationAddress || null,
      latitude: req.body.latitude || null,
      longitude: req.body.longitude || null
    });
    await event.save();

    const io = req.app.get('io');
    io.to(`event:${event._id.toString()}`).emit('event:updated', { eventId: event._id.toString(), event });

    return res.json({ success: true, data: event });
  } catch (error) {
    console.error('Update event error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update event' });
  }
});

// Delete event (organizer only)
router.delete('/:id', checkSuspension, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (event.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the organizer can delete the event' });
    }
    await event.deleteOne();
    const io = req.app.get('io');
    io.to(`event:${req.params.id}`).emit('event:deleted', { eventId: req.params.id });
    return res.json({ success: true, message: 'Event deleted' });
  } catch (error) {
    console.error('Delete event error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete event' });
  }
});

// Accept invitation
router.post('/:id/invite/accept', checkSuspension, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

    const inv = event.invitations.find(i => i.user.toString() === req.user._id.toString());
    if (!inv) return res.status(404).json({ success: false, message: 'No invitation found' });

    event.acceptInvite(req.user._id);
    
    // Optionally auto-RSVP as 'interested' or 'going'
    const autoRSVP = req.body.autoRSVP || 'interested';
    if (['going', 'interested'].includes(autoRSVP)) {
      const canRSVPResult = event.canRSVP(req.user._id);
      if (canRSVPResult.allowed) {
        event.setRSVP(req.user._id, autoRSVP);
      } else if (canRSVPResult.canWaitlist && req.body.joinWaitlist) {
        event.addToWaitlist(req.user._id);
      }
    }
    
    await event.save();

    const io = req.app.get('io');
    io.to(`event:${event._id.toString()}`).emit('event:invite-accepted', { eventId: event._id.toString(), userId: req.user._id.toString() });
    io.to(`user:${event.organizer.toString()}`).emit('event:invite-accepted', { eventId: event._id.toString(), userId: req.user._id.toString() });

    return res.json({ success: true, data: { invitations: event.invitations, rsvps: event.rsvps, waitlist: event.waitlist } });
  } catch (error) {
    console.error('Accept invite error:', error);
    return res.status(500).json({ success: false, message: 'Failed to accept invitation' });
  }
});

// Decline invitation
router.post('/:id/invite/decline', checkSuspension, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

    const inv = event.invitations.find(i => i.user.toString() === req.user._id.toString());
    if (!inv) return res.status(404).json({ success: false, message: 'No invitation found' });

    event.declineInvite(req.user._id);
    await event.save();

    const io = req.app.get('io');
    io.to(`user:${event.organizer.toString()}`).emit('event:invite-declined', { eventId: event._id.toString(), userId: req.user._id.toString() });

    return res.json({ success: true, data: { invitations: event.invitations } });
  } catch (error) {
    console.error('Decline invite error:', error);
    return res.status(500).json({ success: false, message: 'Failed to decline invitation' });
  }
});

// RSVP to event (with capacity enforcement)
router.post('/:id/rsvp', checkSuspension, [
  body('status').notEmpty().isIn(['going', 'interested', 'declined'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

    // Check capacity before allowing RSVP=going
    if (req.body.status === 'going') {
      const canRSVPResult = event.canRSVP(req.user._id);
      if (!canRSVPResult.allowed) {
        // Offer waitlist
        if (req.body.joinWaitlist && canRSVPResult.canWaitlist) {
          event.addToWaitlist(req.user._id);
          await event.save();
          return res.status(200).json({ success: true, message: 'Added to waitlist', onWaitlist: true, data: { waitlist: event.waitlist } });
        }
        return res.status(400).json({ success: false, message: canRSVPResult.reason, canWaitlist: canRSVPResult.canWaitlist });
      }
    }

    event.setRSVP(req.user._id, req.body.status);
    
    // If user was on waitlist and now RSVPing, remove from waitlist
    event.removeFromWaitlist(req.user._id);
    
    await event.save();

    // Notify organizer (and optionally other attendees) on RSVP
    const io = req.app.get('io');
    io.to(`event:${event._id.toString()}`).emit('event:rsvp', { eventId: event._id.toString(), userId: req.user._id.toString(), status: req.body.status });
    io.to(`user:${event.organizer.toString()}`).emit('event:rsvp', { eventId: event._id.toString(), userId: req.user._id.toString(), status: req.body.status });

    // Create notification for organizer
    try {
      await Notification.createNotification({
        recipient: event.organizer,
        sender: req.user._id,
        type: 'event_rsvp',
        message: `${req.user.name} is ${req.body.status} for ${event.title}`
      });
    } catch (e) { /* ignore */ }

    return res.json({ success: true, data: { attendeesCount: event.attendeesCount, rsvps: event.rsvps } });
  } catch (error) {
    console.error('RSVP error:', error);
    return res.status(500).json({ success: false, message: 'Failed to RSVP' });
  }
});

// Invite users
router.post('/:id/invite', checkSuspension, [ body('userIds').isArray({ min: 1, max: 100 }) ], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (event.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only organizer can invite' });
    }

    event.inviteUsers(req.body.userIds);
    await event.save();

    const io = req.app.get('io');
    req.body.userIds.forEach(uid => {
      io.to(`user:${uid}`).emit('event:invited', { eventId: event._id.toString(), by: req.user._id.toString() });
    });

    // Notifications
    try {
      await Promise.all((req.body.userIds || []).map(uid => Notification.createNotification({ recipient: uid, sender: req.user._id, type: 'event_invite' })));
    } catch (e) { /* ignore */ }

    return res.json({ success: true, data: event.invitations });
  } catch (error) {
    console.error('Invite error:', error);
    return res.status(500).json({ success: false, message: 'Failed to invite users' });
  }
});

// List attendees (going + interested)
router.get('/:id/attendees', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).populate('rsvps.user', 'name avatar');
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const attendees = event.rsvps.filter(r => r.status === 'going' || r.status === 'interested');
    return res.json({ success: true, data: attendees });
  } catch (error) {
    console.error('Attendees error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch attendees' });
  }
});

// Check-in endpoint
router.post('/:id/checkin', checkSuspension, [
  body('method').optional().isIn(['qr', 'code', 'manual', 'geo']),
  body('locationName').optional().isString()
], async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

    // Optionally require RSVP 'going' to check-in
    const r = event.rsvps.find(r => r.user.toString() === req.user._id.toString());
    if (!r || r.status !== 'going') {
      return res.status(400).json({ success: false, message: 'Only attendees marked as going can check in' });
    }

    event.checkInUser(req.user._id, req.body.method || 'code', req.body.locationName || null);
    await event.save();

    const io = req.app.get('io');
    io.to(`event:${event._id.toString()}`).emit('event:checkin', { eventId: event._id.toString(), userId: req.user._id.toString() });
    io.to(`user:${event.organizer.toString()}`).emit('event:checkin', { eventId: event._id.toString(), userId: req.user._id.toString() });

    // Notification to organizer
    try {
      await Notification.createNotification({ recipient: event.organizer, sender: req.user._id, type: 'event_checkin' });
    } catch (e) { /* ignore */ }

    return res.json({ success: true, data: event.checkIns });
  } catch (error) {
    console.error('Check-in error:', error);
    return res.status(500).json({ success: false, message: 'Failed to check in' });
  }
});


// Join waitlist
router.post('/:id/waitlist/join', checkSuspension, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    
    if (!event.capacity) {
      return res.status(400).json({ success: false, message: 'Event has no capacity limit' });
    }
    
    if (event.attendeesCount < event.capacity) {
      return res.status(400).json({ success: false, message: 'Event is not full, RSVP directly' });
    }

    event.addToWaitlist(req.user._id);
    await event.save();

    return res.json({ success: true, data: { waitlist: event.waitlist, position: event.waitlist.length } });
  } catch (error) {
    console.error('Join waitlist error:', error);
    return res.status(500).json({ success: false, message: 'Failed to join waitlist' });
  }
});

// Leave waitlist
router.post('/:id/waitlist/leave', checkSuspension, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

    event.removeFromWaitlist(req.user._id);
    await event.save();

    return res.json({ success: true, message: 'Removed from waitlist' });
  } catch (error) {
    console.error('Leave waitlist error:', error);
    return res.status(500).json({ success: false, message: 'Failed to leave waitlist' });
  }
});

// iCalendar export
router.get('/:id/ical', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).populate('organizer', 'name email');
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

    // Generate ICS file
    const ics = require('ics');
    const start = new Date(event.startTime);
    const end = event.endTime ? new Date(event.endTime) : new Date(start.getTime() + 60 * 60 * 1000);
    
    const icsEvent = {
      start: [start.getFullYear(), start.getMonth() + 1, start.getDate(), start.getHours(), start.getMinutes()],
      end: [end.getFullYear(), end.getMonth() + 1, end.getDate(), end.getHours(), end.getMinutes()],
      title: event.title,
      description: event.description || '',
      location: event.locationName || event.locationAddress || '',
      url: `${process.env.APP_URL || 'https://freetalk.site'}/events/${event._id}`,
      organizer: { name: event.organizer.name, email: event.organizer.email },
      status: 'CONFIRMED',
      busyStatus: 'BUSY',
      uid: event._id.toString()
    };

    const { error, value } = ics.createEvent(icsEvent);
    if (error) {
      console.error('ICS generation error:', error);
      return res.status(500).json({ success: false, message: 'Failed to generate calendar file' });
    }

    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', `attachment; filename="event-${event._id}.ics"`);
    return res.send(value);
  } catch (error) {
    console.error('iCal export error:', error);
    return res.status(500).json({ success: false, message: 'Failed to export calendar' });
  }
});

// Nearby events (geospatial)
router.get('/discover/nearby', searchLimiter, [
  query('lat').notEmpty().isFloat({ min: -90, max: 90 }),
  query('lng').notEmpty().isFloat({ min: -180, max: 180 }),
  query('maxDistance').optional().isInt({ min: 100, max: 100000 }), // meters
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { lat, lng, maxDistance = 10000, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const events = await Event.find({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseInt(maxDistance)
        }
      },
      visibility: 'public',
      startTime: { $gte: new Date() }
    })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-invitations');

    return res.json({ success: true, data: { events, count: events.length } });
  } catch (error) {
    console.error('Nearby events error:', error);
    return res.status(500).json({ success: false, message: 'Failed to find nearby events' });
  }
});

// Join/Leave event socket room - lightweight HTTP to receive room name
router.post('/:id/subscribe', async (req, res) => {
  try {
    // Client should call socket.emit('events:subscribe', { eventId }) to join in realtime
    return res.json({ success: true, room: `event:${req.params.id}` });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed' });
  }
});

module.exports = router;
