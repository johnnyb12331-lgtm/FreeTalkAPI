# Brevo Email Service Setup Guide

**Date:** October 12, 2025  
**Service:** Brevo (formerly Sendinblue)  
**Website:** https://app.brevo.com/

## Why Brevo?

✅ **Free Tier:** 300 emails/day forever  
✅ **Reliable Delivery:** Better than Gmail for production  
✅ **No App Passwords:** Simple API key authentication  
✅ **Email Analytics:** Track opens, clicks, bounces  
✅ **Professional:** Designed for transactional emails  

## Step 1: Create Brevo Account

1. Go to https://app.brevo.com/
2. Click "Sign up free"
3. Fill in your details:
   - Email: johnnyb12331@gmail.com
   - Company name: FreeTalk
   - Choose "App" as your business type
4. Verify your email address

## Step 2: Get SMTP Credentials

### Option A: SMTP (Recommended for NodeMailer)

1. Log into Brevo dashboard
2. Click on your profile (top right) → **"SMTP & API"**
3. Navigate to **"SMTP"** tab
4. You'll see:
   - **SMTP Server:** `smtp-relay.brevo.com`
   - **Port:** `587` (TLS) or `465` (SSL)
   - **Login:** Your Brevo account email
   - **SMTP Key:** Click "Create a new SMTP key"

5. Create SMTP key:
   - Name: `FreeTalk-Production`
   - Click "Generate"
   - **COPY THE KEY IMMEDIATELY** (you won't see it again!)

### Option B: API (Alternative)

1. Go to **"API"** tab
2. Click "Create a new API key"
3. Name: `FreeTalk-API`
4. Copy the API key

## Step 3: Configure Sender Email

1. Go to **"Senders"** in the left menu
2. Click **"Add a sender"**
3. Fill in:
   - **Email:** noreply@freetalk.site (or your verified domain)
   - **Name:** FreeTalk
   - **Reply to:** support@freetalk.site (optional)
4. Click "Add"
5. **Verify the email** by clicking the link sent to that address

**Note:** For free accounts, you can only send from verified email addresses.

## Step 4: (Optional) Verify Your Domain

For better deliverability and to use any email address:

1. Go to **"Senders"** → **"Domains"**
2. Click **"Add a domain"**
3. Enter: `freetalk.site`
4. Add the DNS records shown (SPF, DKIM, DMARC)
5. Wait for verification (can take up to 48 hours)

## Step 5: Update .env File

Add these to your `FreeTalkAPI/.env` file:

```env
# ====================================================================
# BREVO EMAIL CONFIGURATION (For Password Reset & Notifications)
# ====================================================================

# Frontend URL (for password reset links)
FRONTEND_URL=https://freetalk.site

# Brevo SMTP Configuration
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-brevo-login-email@example.com
EMAIL_PASS=your-brevo-smtp-key-here
EMAIL_FROM=FreeTalk <noreply@freetalk.site>
```

### Example with Real Values:

```env
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=johnnyb12331@gmail.com
EMAIL_PASS=xsmtpsib-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
EMAIL_FROM=FreeTalk <noreply@freetalk.site>
```

## Step 6: Test Email Service

Run the test script:

```bash
cd FreeTalkAPI
node test-email-service.js
```

You should see:
```
✅ SMTP connection verified!
✅ Test email sent successfully!
```

## Brevo Dashboard Features

### Monitor Email Sending

1. **Statistics:** See delivery rates, opens, clicks
2. **Logs:** View all sent emails and their status
3. **Contacts:** Manage email lists (optional)
4. **Templates:** Create reusable email templates (future)

### Free Tier Limits

- ✅ 300 emails/day
- ✅ Unlimited contacts
- ✅ Email support
- ✅ SMTP relay
- ✅ Real-time statistics

### Paid Plans (if needed)

- **Lite:** $25/month - 10,000 emails/month
- **Business:** $65/month - 20,000 emails/month, advanced features
- **Enterprise:** Custom pricing

## Troubleshooting

### Error: "Authentication failed"

**Solution:**
- Verify EMAIL_USER is your Brevo login email
- Verify EMAIL_PASS is the SMTP key (not API key)
- Check for extra spaces in .env file
- Regenerate SMTP key if needed

### Error: "Sender not verified"

**Solution:**
- Verify the sender email in Brevo dashboard
- Use the exact email address you verified
- Wait a few minutes after verification

### Error: "Daily quota exceeded"

**Solution:**
- You've sent 300+ emails today
- Wait until tomorrow (resets at midnight UTC)
- Upgrade to paid plan if needed

### Emails Going to Spam

**Solution:**
- Verify your domain (add SPF, DKIM records)
- Use a professional sender name
- Avoid spam trigger words
- Add unsubscribe link (for marketing emails)

## Security Best Practices

1. ✅ **Never commit .env file** to git
2. ✅ **Use different SMTP keys** for dev/production
3. ✅ **Rotate keys periodically** (every 90 days)
4. ✅ **Monitor suspicious activity** in Brevo logs
5. ✅ **Set up rate limiting** in your API

## Production Deployment

### Update Production .env

SSH into your server:

```bash
ssh root@167.71.97.187
cd /root/FreeTalkAPI
nano .env
```

Add the Brevo configuration, then restart:

```bash
pm2 restart freetalk-api
pm2 logs freetalk-api
```

### Test in Production

```bash
curl -X POST https://freetalk.site/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"your-test-email@example.com"}'
```

Expected response:
```json
{
  "success": true,
  "message": "Password reset link has been sent to your email address."
}
```

## Additional Resources

- 📚 **Brevo Documentation:** https://developers.brevo.com/
- 📧 **SMTP Documentation:** https://developers.brevo.com/docs/send-emails-via-smtp
- 🔧 **API Documentation:** https://developers.brevo.com/reference/sendtransacemail
- 💬 **Support:** https://help.brevo.com/

## Quick Reference

| Setting | Value |
|---------|-------|
| **SMTP Host** | `smtp-relay.brevo.com` |
| **SMTP Port** | `587` (TLS) or `465` (SSL) |
| **Authentication** | LOGIN |
| **Username** | Your Brevo login email |
| **Password** | SMTP key (from dashboard) |
| **Encryption** | STARTTLS (port 587) or SSL (port 465) |

---

**Next Steps:**
1. Get your Brevo SMTP credentials
2. Update the .env file
3. Test the email service
4. Deploy to production
5. Monitor email delivery in Brevo dashboard
