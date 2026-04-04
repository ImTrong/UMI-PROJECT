import nodemailer from 'nodemailer';

class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verifyUrl = `${frontendUrl}/verify-email?token=${token}`;

    const mailOptions = {
      from: process.env.SMTP_FROM || '"UMI E-Learning" <noreply@umi.local>',
      to: email,
      subject: 'Verify Your Email Address - UMI Project',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 10px; overflow: hidden;">
          <div style="background-color: #4f46e5; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">UMI E-Learning</h1>
          </div>
          <div style="padding: 30px; background-color: #f9fafb;">
            <h2 style="color: #1f2937; margin-top: 0;">Verify Your Email Address</h2>
            <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
              Thank you for registering. Please click the button below to verify your email address and activate your account.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verifyUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                Verify Email
              </a>
            </div>
            <p style="color: #6b7280; font-size: 14px; margin-bottom: 0;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <a href="${verifyUrl}" style="color: #4f46e5;">${verifyUrl}</a>
            </p>
          </div>
          <div style="background-color: #f3f4f6; padding: 15px; text-align: center; border-top: 1px solid #eaeaea;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} UMI E-Learning. All rights reserved.</p>
          </div>
        </div>
      `,
    };

    try {
      // If credentials are not set, just log it (useful for local dev)
      if (!process.env.SMTP_USER) {
        console.warn(`[DEV MODE] Skipping actual email. Verification Link for ${email}: ${verifyUrl}`);
        return;
      }
      
      await this.transporter.sendMail(mailOptions);
      console.log(`Verification email sent successfully to ${email}`);
    } catch (error) {
      console.error('Error sending verification email:', error);
      throw new Error('Failed to send verification email');
    }
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    const mailOptions = {
      from: process.env.SMTP_FROM || '"UMI E-Learning" <noreply@umi.local>',
      to: email,
      subject: 'Password Reset Request - UMI Project',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 10px; overflow: hidden;">
          <div style="background-color: #4f46e5; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">UMI E-Learning</h1>
          </div>
          <div style="padding: 30px; background-color: #f9fafb;">
            <h2 style="color: #1f2937; margin-top: 0;">Reset Your Password</h2>
            <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
              We received a request to reset your password. Click the button below to choose a new password. This link will expire in 15 minutes.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                Reset Password
              </a>
            </div>
            <p style="color: #6b7280; font-size: 14px; margin-bottom: 0;">
              If you did not request a password reset, please ignore this email or contact support if you have concerns.
            </p>
          </div>
        </div>
      `,
    };

    try {
      if (!process.env.SMTP_USER) {
        console.warn(`[DEV MODE] Skipping actual email. Password Reset Link for ${email}: ${resetUrl}`);
        return;
      }
      
      await this.transporter.sendMail(mailOptions);
      console.log(`Password reset email sent successfully to ${email}`);
    } catch (error) {
      console.error('Error sending password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  }
}

export const emailService = new EmailService();
