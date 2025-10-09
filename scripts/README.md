# Admin Management Scripts

Convenient scripts to manage admin users, premium subscriptions, and verification in your FreeTalk application.

## Prerequisites

Make sure you're in the `FreeTalkAPI` directory and your MongoDB server is running.

## 🆕 Status Management Scripts

### Migrate Verified Users
Migrates users who received free verification before Premium/Verified separation:
```bash
# Dry run (preview changes)
node scripts/migrate-verified-users.js --dry-run

# Actually perform migration
node scripts/migrate-verified-users.js
```

## Available Scripts

### 1. Make User Admin

Grant admin privileges to a user by email:

```bash
node scripts/makeAdmin.js your@email.com
```

**Example:**
```bash
node scripts/makeAdmin.js john@example.com
```

**Output:**
```
✅ SUCCESS! Admin privileges granted!
═══════════════════════════════════
👤 Name: John Doe
📧 Email: john@example.com
👑 Admin: true
📅 Updated: 10/5/2025, 3:45:23 PM
═══════════════════════════════════

🎯 Next Steps:
1. Restart your Flutter app
2. Go to Profile → Profile Settings
3. You should now see "Admin Reports" option
```

---

### 2. Remove Admin Privileges

Remove admin privileges from a user:

```bash
node scripts/removeAdmin.js your@email.com
```

**Example:**
```bash
node scripts/removeAdmin.js john@example.com
```

**Output:**
```
✅ SUCCESS! Admin privileges removed!
═══════════════════════════════════
👤 Name: John Doe
📧 Email: john@example.com
👑 Admin: false
📅 Updated: 10/5/2025, 3:50:12 PM
═══════════════════════════════════
```

---

### 3. List All Admins

View all users with admin privileges:

```bash
node scripts/listAdmins.js
```

**Output:**
```
👑 Found 2 Admin Users:
═══════════════════════════════════════════════════════════

1. John Doe
   📧 Email: john@example.com
   🆔 ID: 507f1f77bcf86cd799439011
   📅 Joined: 10/1/2025

2. Jane Smith
   📧 Email: jane@example.com
   🆔 ID: 507f191e810c19729de860ea
   📅 Joined: 10/3/2025

═══════════════════════════════════════════════════════════

✅ Total Admin Users: 2
```

---

## Quick Start

1. **Navigate to API directory:**
   ```bash
   cd FreeTalkAPI
   ```

2. **Make yourself admin:**
   ```bash
   node scripts/makeAdmin.js your@email.com
   ```

3. **Verify it worked:**
   ```bash
   node scripts/listAdmins.js
   ```

4. **Restart your Flutter app** to see the changes!

---

## Troubleshooting

**Error: "User not found"**
- Make sure you're using the correct email address
- Check that the user account exists in the database
- Email addresses are case-insensitive

**Error: "Cannot connect to MongoDB"**
- Make sure MongoDB is running
- Check your `.env` file for correct `MONGODB_URI`
- Default: `mongodb://localhost:27017/freetalk`

**Error: "Module not found"**
- Make sure you're in the `FreeTalkAPI` directory
- Run `npm install` to install dependencies

---

## Notes

- Changes take effect immediately in the database
- Users must restart the app to see admin features
- You can have multiple admin users
- Admin status is stored in the `isAdmin` field in the users collection

---

### 5. Fix Corrupted Posts

Clean up posts with invalid user references (fixes CastError issues):

```bash
node scripts/fixCorruptedPosts.js
```

**What it does:**
- Scans all posts for invalid ObjectId references
- Removes comments/replies with invalid user IDs
- Cleans up invalid taggedUsers and mentionedUsers
- Reports all issues found and fixed

**When to use:**
- When you see "CastError: Cast to ObjectId failed" errors
- After database migrations or manual data edits
- If posts fail to load due to corrupted references

**Example Output:**
```
Starting to check for corrupted posts...
Found 150 posts to check

⚠️  Post 507f1f77bcf86cd799439011: Invalid user in comment: user
✅ Fixed post 507f1f77bcf86cd799439011

=== Summary ===
Total posts checked: 150
Corrupted posts found: 3
Posts fixed: 3
===============
```

---

## See Also

- `ADMIN_SETUP.md` - Complete admin setup guide
- `REPORTING_SYSTEM.md` - Reporting system documentation

