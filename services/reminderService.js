const User = require('../models/User');
const Event = require('../models/Event');
const Notification = require('../models/Notification');
const FCM = require('./fcmService');

const MS_IN_DAY = 24 * 60 * 60 * 1000;

class ReminderService {
  constructor(io) {
    this.io = io;
    this._interval = null;
  }

  start() {
    // Run shortly after startup, then every hour
    this.runSafely();
    this._interval = setInterval(() => this.runSafely(), 60 * 60 * 1000);
    console.log('⏰ ReminderService scheduled (hourly)');
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
  }

  async runSafely() {
    try {
      await this.sendBirthdayReminders();
      await this.sendEventReminders();
    } catch (e) {
      console.error('ReminderService error:', e);
    }
  }

  async sendBirthdayReminders() {
    // Notify friends/followers of upcoming birthdays (today)
    const now = new Date();
    const month = now.getUTCMonth();
    const date = now.getUTCDate();

    const usersWithBirthday = await User.find({ birthday: { $ne: null } })
      .select('name birthday followers settings');

    for (const u of usersWithBirthday) {
      const b = new Date(u.birthday);
      if (b.getUTCMonth() === month && b.getUTCDate() === date) {
        // send to followers who allow notifications
        const recipients = Array.isArray(u.followers) ? u.followers : [];
        await Promise.all(recipients.map(async rid => {
          try {
            await Notification.createNotification({ recipient: rid, sender: u._id, type: 'birthday_reminder', message: `It's ${u.name}'s birthday today!` });
            this.io.to(`user:${rid.toString()}`).emit('birthday:today', { userId: u._id.toString(), name: u.name });
            await FCM.sendNotificationToUser(rid, 'Birthday Today', `Wish ${u.name} a happy birthday!`, { type: 'birthday' });
          } catch (e) { /* ignore */ }
        }));
      }
    }
  }

  async sendEventReminders() {
    // Send reminders 1 hour before start
    const now = Date.now();
    const inOneHour = new Date(now + 60 * 60 * 1000);
    const in65 = new Date(now + 65 * 60 * 1000); // window to avoid duplicate sends on hourly schedule

    const upcoming = await Event.find({ startTime: { $gte: inOneHour, $lte: in65 } }).select('title startTime organizer rsvps');
    for (const ev of upcoming) {
      const recipients = new Set();
      if (ev.organizer) recipients.add(ev.organizer.toString());
      (ev.rsvps || []).forEach(r => { if (r.status === 'going') recipients.add(r.user.toString()); });

      await Promise.all(Array.from(recipients).map(async rid => {
        try {
          await FCM.sendNotificationToUser(rid, 'Event starting soon', `${ev.title} starts in about 1 hour`, { type: 'event_reminder', eventId: ev._id.toString() });
          this.io.to(`user:${rid}`).emit('event:reminder', { eventId: ev._id.toString(), startsAt: ev.startTime });
        } catch (e) { /* ignore */ }
      }));
    }
  }
}

module.exports = ReminderService;
