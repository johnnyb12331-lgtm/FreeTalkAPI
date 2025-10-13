const nodemailer = require('nodemailer');

// Create reusable transporter object using Brevo SMTP
const createTransporter = () => {
  // Check if email configuration exists
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('⚠️  Email configuration not found. Email features will be disabled.');
    console.warn('⚠️  Please set EMAIL_HOST, EMAIL_USER, EMAIL_PASS in .env file');
    console.warn('⚠️  See BREVO_SETUP.md for configuration instructions');
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST, // smtp-relay.brevo.com
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true', // false for port 587
    auth: {
      user: process.env.EMAIL_USER, // Your Brevo login email
      pass: process.env.EMAIL_PASS, // Your Brevo SMTP key
    },
    // Connection timeouts
    connectionTimeout: 10000, // 10 seconds
    socketTimeout: 20000, // 20 seconds
    greetingTimeout: 10000, // 10 seconds
  });
};

/**
 * Send password reset email using Brevo
 * @param {string} email - Recipient email address
 * @param {string} resetToken - Password reset token
 * @param {string} userName - User's name for personalization
 */
const sendPasswordResetEmail = async (email, resetToken, userName) => {
  const transporter = createTransporter();
  
  if (!transporter) {
    throw new Error('Email service not configured. Please check BREVO_SETUP.md');
  }

  // Determine the frontend URL
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

  // Email HTML content with professional design
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your Password - FreeTalk</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          background-color: #f4f4f4;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 30px auto;
          background: #ffffff;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          overflow: hidden;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 30px;
          text-align: center;
        }
        .header h1 {
          color: #ffffff;
          margin: 0;
          font-size: 28px;
        }
        .content {
          padding: 40px 30px;
        }
        .content h2 {
          color: #333;
          margin-top: 0;
        }
        .content p {
          margin: 15px 0;
          color: #555;
        }
        .button {
          display: inline-block;
          padding: 14px 30px;
          margin: 20px 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #ffffff !important;
          text-decoration: none;
          border-radius: 5px;
          font-weight: bold;
          text-align: center;
        }
        .button:hover {
          opacity: 0.9;
        }
        .warning {
          background-color: #fff3cd;
          border-left: 4px solid #ffc107;
          padding: 15px;
          margin: 20px 0;
          border-radius: 4px;
        }
        .footer {
          background-color: #f8f9fa;
          padding: 20px 30px;
          text-align: center;
          font-size: 12px;
          color: #666;
          border-top: 1px solid #e9ecef;
        }
        .url-fallback {
          word-break: break-all;
          background-color: #f8f9fa;
          padding: 10px;
          border-radius: 4px;
          font-size: 12px;
          margin-top: 15px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔐 FreeTalk</h1>
        </div>
        <div class="content">
          <h2>Hello ${userName || 'there'},</h2>
          <p>We received a request to reset your password for your FreeTalk account.</p>
          <p>Click the button below to reset your password:</p>
          
          <div style="text-align: center;">
            <a href="${resetUrl}" class="button">Reset Password</a>
          </div>
          
          <div class="warning">
            <strong>⚠️ Security Notice:</strong>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>This link will expire in 1 hour</li>
              <li>If you didn't request this, please ignore this email</li>
              <li>Never share this link with anyone</li>
            </ul>
          </div>
          
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <div class="url-fallback">
            ${resetUrl}
          </div>
          
          <p style="margin-top: 30px; color: #666;">If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} FreeTalk. All rights reserved.</p>
          <p>This is an automated message, please do not reply to this email.</p>
          <p style="margin-top: 10px;">Powered by Brevo</p>
        </div>
      </div>
    </body>
    </html>
  `;

  // Plain text alternative
  const textContent = `
Hello ${userName || 'there'},

We received a request to reset your password for your FreeTalk account.

Click the link below to reset your password:
${resetUrl}

⚠️ Security Notice:
- This link will expire in 1 hour
- If you didn't request this, please ignore this email
- Never share this link with anyone

If you did not request a password reset, please ignore this email or contact support if you have concerns.

© ${new Date().getFullYear()} FreeTalk. All rights reserved.
This is an automated message, please do not reply to this email.
  `;

  const mailOptions = {
    from: process.env.EMAIL_FROM || `"FreeTalk" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Reset Your Password - FreeTalk',
    text: textContent,
    html: htmlContent,
  };

  try {
    // Add a timeout wrapper to prevent hanging indefinitely (30 seconds max)
    const sendMailWithTimeout = Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Email send timeout (30s exceeded)')), 30000)
      )
    ]);

    const info = await sendMailWithTimeout;
    console.log('✅ Password reset email sent via Brevo:', info.messageId);
    console.log('📧 Recipient:', email);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Error sending password reset email via Brevo:', error);
    console.error('💡 Check your Brevo SMTP credentials in .env file');
    throw new Error(`Failed to send password reset email: ${error.message}`);
  }
};

/**
 * Send password reset confirmation email using Brevo
 * @param {string} email - Recipient email address
 * @param {string} userName - User's name for personalization
 */
const sendPasswordResetConfirmation = async (email, userName) => {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.warn('⚠️  Email service not configured. Skipping confirmation email.');
    return { success: false, message: 'Email service not configured' };
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset Successful - FreeTalk</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          background-color: #f4f4f4;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 30px auto;
          background: #ffffff;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          overflow: hidden;
        }
        .header {
          background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
          padding: 30px;
          text-align: center;
        }
        .header h1 {
          color: #ffffff;
          margin: 0;
          font-size: 28px;
        }
        .content {
          padding: 40px 30px;
        }
        .content h2 {
          color: #333;
          margin-top: 0;
        }
        .content p {
          margin: 15px 0;
          color: #555;
        }
        .success-icon {
          text-align: center;
          font-size: 60px;
          color: #38ef7d;
          margin: 20px 0;
        }
        .info-box {
          background-color: #e7f3ff;
          border-left: 4px solid #2196F3;
          padding: 15px;
          margin: 20px 0;
          border-radius: 4px;
        }
        .footer {
          background-color: #f8f9fa;
          padding: 20px 30px;
          text-align: center;
          font-size: 12px;
          color: #666;
          border-top: 1px solid #e9ecef;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔐 FreeTalk</h1>
        </div>
        <div class="content">
          <div class="success-icon">✅</div>
          <h2>Password Reset Successful</h2>
          <p>Hello ${userName || 'there'},</p>
          <p>Your password has been successfully reset. You can now log in to your FreeTalk account with your new password.</p>
          
          <div class="info-box">
            <strong>🛡️ Security Tips:</strong>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Use a strong, unique password</li>
              <li>Don't share your password with anyone</li>
              <li>Enable two-factor authentication if available</li>
              <li>Sign out from devices you don't recognize</li>
            </ul>
          </div>
          
          <p style="margin-top: 30px; color: #666;"><strong>⚠️ Didn't make this change?</strong> Please contact our support team immediately at support@freetalk.site</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} FreeTalk. All rights reserved.</p>
          <p>This is an automated message, please do not reply to this email.</p>
          <p style="margin-top: 10px;">Powered by Brevo</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
Password Reset Successful

Hello ${userName || 'there'},

Your password has been successfully reset. You can now log in to your FreeTalk account with your new password.

🛡️ Security Tips:
- Use a strong, unique password
- Don't share your password with anyone
- Enable two-factor authentication if available
- Sign out from devices you don't recognize

⚠️ Didn't make this change? Please contact our support team immediately at support@freetalk.site

© ${new Date().getFullYear()} FreeTalk. All rights reserved.
This is an automated message, please do not reply to this email.
  `;

  const mailOptions = {
    from: process.env.EMAIL_FROM || `"FreeTalk" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your Password Has Been Reset - FreeTalk',
    text: textContent,
    html: htmlContent,
  };

  try {
    // Add a timeout wrapper
    const sendMailWithTimeout = Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Email send timeout (30s exceeded)')), 30000)
      )
    ]);

    const info = await sendMailWithTimeout;
    console.log('✅ Password reset confirmation email sent via Brevo:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Error sending confirmation email via Brevo:', error);
    // Don't throw error for confirmation email - it's non-critical
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendPasswordResetEmail,
  sendPasswordResetConfirmation,
};
