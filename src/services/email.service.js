// src/services/email.service.js
const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('../utils/logger');

class EmailService {
  static transporter = null;

  static getTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.email.host,
        port: env.email.port,
        secure: env.email.port === 465,
        auth: {
          user: env.email.user,
          pass: env.email.password,
        },
      });
    }
    return this.transporter;
  }

  static async send({ to, subject, html, text }) {
    try {
      const transporter = this.getTransporter();

      const info = await transporter.sendMail({
        from: `"${env.email.fromName}" <${env.email.from}>`,
        to,
        subject,
        text: text || this.stripHtml(html),
        html,
      });

      logger.info('Email sent:', { messageId: info.messageId, to });
      return info;
    } catch (error) {
      logger.error('Email sending failed:', error);
      throw error;
    }
  }

  static stripHtml(html) {
    return html.replace(/<[^>]*>/g, '');
  }

  static async sendWelcomeEmail(user) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { color: white; margin: 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to Altuvera! 🎉</h1>
            </div>
            <div class="content">
              <p>Hi ${user.full_name || user.username},</p>
              <p>We're thrilled to have you on board! Your account has been created successfully.</p>
              <p>Here's what you can do next:</p>
              <ul>
                <li>Complete your profile</li>
                <li>Explore our features</li>
                <li>Check out our subscription plans</li>
              </ul>
              <center>
                <a href="${env.frontendUrl}/dashboard" class="button">Get Started</a>
              </center>
              <p>If you have any questions, feel free to reach out to our support team.</p>
              <p>Best regards,<br>The Altuvera Team</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Altuvera. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return this.send({
      to: user.email,
      subject: 'Welcome to Altuvera! 🎉',
      html,
    });
  }

  static async sendMagicLinkEmail(user, magicLinkUrl) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { color: white; margin: 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            .warning { background: #fff3cd; padding: 10px; border-radius: 5px; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Sign In to Altuvera</h1>
            </div>
            <div class="content">
              <p>Hi ${user.full_name || user.username},</p>
              <p>Click the button below to sign in to your account:</p>
              <center>
                <a href="${magicLinkUrl}" class="button">Sign In</a>
              </center>
              <div class="warning">
                ⚠️ This link will expire in 15 minutes and can only be used once.
              </div>
              <p>If you didn't request this link, you can safely ignore this email.</p>
              <p>Best regards,<br>The Altuvera Team</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Altuvera. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return this.send({
      to: user.email,
      subject: 'Sign in to Altuvera 🔐',
      html,
    });
  }

  static async sendSubscriptionConfirmation(user, subscription, plan) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { color: white; margin: 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .plan-box { background: white; padding: 20px; border-radius: 10px; border: 2px solid #667eea; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Subscription Confirmed! 🎊</h1>
            </div>
            <div class="content">
              <p>Hi ${user.full_name || user.username},</p>
              <p>Thank you for subscribing to Altuvera! Here are your subscription details:</p>
              <div class="plan-box">
                <h3 style="margin-top: 0;">${plan.name}</h3>
                <p><strong>Price:</strong> $${plan.price}/${plan.interval}</p>
                <p><strong>Next billing date:</strong> ${new Date(subscription.current_period_end).toLocaleDateString()}</p>
              </div>
              <p>You now have access to all the features included in your plan!</p>
              <p>Best regards,<br>The Altuvera Team</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Altuvera. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return this.send({
      to: user.email,
      subject: 'Your Altuvera Subscription is Active! 🎊',
      html,
    });
  }

  static async sendSubscriptionExpiring(user, subscription, daysLeft) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #f0ad4e; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { color: white; margin: 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Subscription Expiring Soon ⏰</h1>
            </div>
            <div class="content">
              <p>Hi ${user.full_name || user.username},</p>
              <p>Your subscription will expire in <strong>${daysLeft} days</strong>.</p>
              <p>To continue enjoying our services without interruption, please renew your subscription.</p>
              <center>
                <a href="${env.frontendUrl}/billing" class="button">Renew Now</a>
              </center>
              <p>Best regards,<br>The Altuvera Team</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Altuvera. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return this.send({
      to: user.email,
      subject: `Your subscription expires in ${daysLeft} days ⏰`,
      html,
    });
  }
}

module.exports = EmailService;