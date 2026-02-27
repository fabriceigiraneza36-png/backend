// server/emailServer.js
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware - IMPORTANT: These must come BEFORE routes
app.use(cors({
  origin: '*', // Allow all origins for testing
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug middleware - logs all requests
app.use((req, res, next) => {
  console.log('\n📥 ================================');
  console.log(`📥 ${req.method} ${req.url}`);
  console.log('📥 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📥 Body:', JSON.stringify(req.body, null, 2));
  console.log('📥 ================================\n');
  next();
});

// SMTP Configuration
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'fabriceigiraneza36@gmail.com',
    pass: 'ubfdlzbcikkxpgev' // No spaces in app password
  },
  tls: {
    rejectUnauthorized: false
  },
  debug: true, // Enable debug
  logger: true // Log to console
});

// Verify SMTP on startup
transporter.verify()
  .then(() => console.log('✅ SMTP Server is ready'))
  .catch(err => console.error('❌ SMTP Error:', err.message));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Server is running',
    timestamp: new Date().toISOString() 
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!' });
});

// Contact form endpoint
app.post('/api/contact', async (req, res) => {
  console.log('\n🚀 Processing contact form submission...');
  console.log('📦 Request body type:', typeof req.body);
  console.log('📦 Request body:', req.body);
  
  try {
    // Check if body exists
    if (!req.body || Object.keys(req.body).length === 0) {
      console.log('❌ Empty request body');
      return res.status(400).json({ 
        success: false, 
        message: 'Request body is empty. Make sure Content-Type is application/json' 
      });
    }

    const { 
      name, 
      email, 
      phone, 
      subject, 
      message, 
      tripType, 
      travelDate, 
      travelers 
    } = req.body;

    console.log('📝 Extracted fields:');
    console.log('  - name:', name);
    console.log('  - email:', email);
    console.log('  - phone:', phone);
    console.log('  - subject:', subject);
    console.log('  - message:', message ? message.substring(0, 50) + '...' : 'undefined');
    console.log('  - tripType:', tripType);
    console.log('  - travelDate:', travelDate);
    console.log('  - travelers:', travelers);

    // Validation with detailed errors
    const validationErrors = [];
    
    if (!name || (typeof name === 'string' && !name.trim())) {
      validationErrors.push('Name is required');
    }
    if (!email || (typeof email === 'string' && !email.trim())) {
      validationErrors.push('Email is required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      validationErrors.push('Invalid email format');
    }
    if (!subject || (typeof subject === 'string' && !subject.trim())) {
      validationErrors.push('Subject is required');
    }
    if (!message || (typeof message === 'string' && !message.trim())) {
      validationErrors.push('Message is required');
    }

    if (validationErrors.length > 0) {
      console.log('❌ Validation failed:', validationErrors);
      return res.status(400).json({ 
        success: false, 
        message: validationErrors.join(', '),
        errors: validationErrors
      });
    }

    console.log('✅ Validation passed, preparing emails...');

    // Format trip type
    const tripTypeLabels = {
      'safari': '🦁 Safari Adventure',
      'mountain': '⛰️ Mountain Trekking',
      'gorilla': '🦍 Gorilla Trekking',
      'beach': '🏖️ Beach Holiday',
      'cultural': '🎭 Cultural Tour',
      'photography': '📷 Photography Safari',
      'honeymoon': '💕 Honeymoon',
      'family': '👨‍👩‍👧‍👦 Family Trip',
    };

    const formattedTripType = tripTypeLabels[tripType] || tripType || 'Not specified';
    const formattedDate = travelDate 
      ? new Date(travelDate).toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) 
      : 'Not specified';

    // Admin notification email
    const adminEmailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 20px; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f0fdf4;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #059669 0%, #10B981 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">🦒 New Safari Inquiry</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 14px;">
              A new message from your website
            </p>
          </div>
          
          <!-- Content -->
          <div style="padding: 30px;">
            
            <!-- Contact Info -->
            <div style="background: #f0fdf4; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
              <h2 style="color: #059669; margin: 0 0 15px; font-size: 16px; border-bottom: 2px solid #d1fae5; padding-bottom: 10px;">
                👤 Contact Information
              </h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; width: 100px;">Name:</td>
                  <td style="padding: 8px 0; color: #1f2937; font-weight: 600;">${name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Email:</td>
                  <td style="padding: 8px 0; color: #1f2937; font-weight: 600;">
                    <a href="mailto:${email}" style="color: #059669;">${email}</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Phone:</td>
                  <td style="padding: 8px 0; color: #1f2937; font-weight: 600;">${phone || 'Not provided'}</td>
                </tr>
              </table>
            </div>
            
            <!-- Trip Details -->
            <div style="background: #ecfdf5; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
              <h2 style="color: #059669; margin: 0 0 15px; font-size: 16px; border-bottom: 2px solid #d1fae5; padding-bottom: 10px;">
                ✈️ Trip Details
              </h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; width: 100px;">Type:</td>
                  <td style="padding: 8px 0; color: #1f2937; font-weight: 600;">${formattedTripType}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Date:</td>
                  <td style="padding: 8px 0; color: #1f2937; font-weight: 600;">${formattedDate}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Travelers:</td>
                  <td style="padding: 8px 0; color: #1f2937; font-weight: 600;">${travelers || 'Not specified'}</td>
                </tr>
              </table>
            </div>
            
            <!-- Subject -->
            <h2 style="color: #1f2937; margin: 0 0 10px; font-size: 16px;">📌 Subject</h2>
            <p style="background: #f9fafb; padding: 15px; border-radius: 8px; border-left: 4px solid #059669; margin: 0 0 20px; color: #374151;">
              ${subject}
            </p>
            
            <!-- Message -->
            <h2 style="color: #1f2937; margin: 0 0 10px; font-size: 16px;">💬 Message</h2>
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; color: #374151; line-height: 1.7;">
              ${message.replace(/\n/g, '<br>')}
            </div>
            
            <!-- Reply Button -->
            <div style="text-align: center; margin-top: 30px;">
              <a href="mailto:${email}?subject=Re: ${encodeURIComponent(subject)}" 
                 style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #10B981 100%); color: white; text-decoration: none; padding: 14px 30px; border-radius: 8px; font-weight: 600; font-size: 14px;">
                ↩️ Reply to ${name.split(' ')[0]}
              </a>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: #064e3b; padding: 20px; text-align: center;">
            <p style="color: rgba(255,255,255,0.8); margin: 0; font-size: 12px;">
              Submitted via Altuvera Safaris Contact Form
            </p>
            <p style="color: rgba(255,255,255,0.6); margin: 8px 0 0; font-size: 11px;">
              ${new Date().toLocaleString('en-US', { 
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
              })}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Customer confirmation email
    const customerEmailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 20px; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f0fdf4;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #059669 0%, #10B981 100%); padding: 40px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🌍 Altuvera Safaris</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">
              Your African Adventure Awaits!
            </p>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px;">
            <h2 style="color: #1f2937; margin: 0 0 20px; font-size: 22px;">
              Hello ${name.split(' ')[0]}! 👋
            </h2>
            
            <p style="color: #4b5563; line-height: 1.8; margin: 0 0 20px;">
              Thank you for reaching out to us! We're thrilled that you're considering an African safari adventure with Altuvera Safaris.
            </p>
            
            <p style="color: #4b5563; line-height: 1.8; margin: 0 0 30px;">
              Our team of expert safari planners has received your inquiry and will get back to you within <strong style="color: #059669;">24 hours</strong> with personalized recommendations.
            </p>
            
            <!-- Summary Box -->
            <div style="background: #f0fdf4; border-radius: 12px; padding: 20px; border: 1px solid #d1fae5; margin-bottom: 30px;">
              <h3 style="color: #059669; margin: 0 0 15px; font-size: 16px;">📋 Your Inquiry Summary</h3>
              <p style="margin: 8px 0; color: #374151;"><strong>Subject:</strong> ${subject}</p>
              ${tripType ? `<p style="margin: 8px 0; color: #374151;"><strong>Trip Type:</strong> ${formattedTripType}</p>` : ''}
              ${travelDate ? `<p style="margin: 8px 0; color: #374151;"><strong>Travel Date:</strong> ${formattedDate}</p>` : ''}
              ${travelers ? `<p style="margin: 8px 0; color: #374151;"><strong>Travelers:</strong> ${travelers}</p>` : ''}
            </div>
            
            <!-- What's Next -->
            <h3 style="color: #1f2937; margin: 0 0 15px; font-size: 18px;">🚀 What happens next?</h3>
            <div style="margin-bottom: 30px;">
              <div style="display: flex; align-items: flex-start; margin-bottom: 15px;">
                <span style="display: inline-block; width: 28px; height: 28px; background: #d1fae5; border-radius: 50%; text-align: center; line-height: 28px; font-size: 14px; color: #059669; font-weight: 600; margin-right: 12px; flex-shrink: 0;">1</span>
                <p style="margin: 0; color: #4b5563; line-height: 1.6;"><strong>Review</strong> - Our safari experts will review your requirements</p>
              </div>
              <div style="display: flex; align-items: flex-start; margin-bottom: 15px;">
                <span style="display: inline-block; width: 28px; height: 28px; background: #d1fae5; border-radius: 50%; text-align: center; line-height: 28px; font-size: 14px; color: #059669; font-weight: 600; margin-right: 12px; flex-shrink: 0;">2</span>
                <p style="margin: 0; color: #4b5563; line-height: 1.6;"><strong>Design</strong> - We'll create a personalized itinerary just for you</p>
              </div>
              <div style="display: flex; align-items: flex-start;">
                <span style="display: inline-block; width: 28px; height: 28px; background: #d1fae5; border-radius: 50%; text-align: center; line-height: 28px; font-size: 14px; color: #059669; font-weight: 600; margin-right: 12px; flex-shrink: 0;">3</span>
                <p style="margin: 0; color: #4b5563; line-height: 1.6;"><strong>Connect</strong> - We'll reach out with your custom proposal</p>
              </div>
            </div>
            
            <!-- Contact Box -->
            <div style="background: #064e3b; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 30px;">
              <p style="color: rgba(255,255,255,0.9); margin: 0 0 12px; font-size: 14px;">
                Can't wait? Reach us directly:
              </p>
              <p style="margin: 5px 0;">
                <a href="tel:+254700123456" style="color: #34d399; text-decoration: none; font-size: 14px;">📞 +254 700 123 456</a>
              </p>
              <p style="margin: 5px 0;">
                <a href="https://wa.me/254700123456" style="color: #34d399; text-decoration: none; font-size: 14px;">💬 WhatsApp Us</a>
              </p>
            </div>
            
            <!-- CTA Button -->
            <div style="text-align: center;">
              <a href="https://altuverasafaris.com" 
                 style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #10B981 100%); color: white; text-decoration: none; padding: 14px 36px; border-radius: 8px; font-weight: 600; font-size: 15px;">
                🦁 Explore Safari Packages
              </a>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: #f9fafb; padding: 25px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; margin: 0 0 10px; font-size: 13px;">
              Follow our adventures on social media
            </p>
            <p style="margin: 0;">
              <a href="#" style="color: #059669; text-decoration: none; margin: 0 8px; font-size: 13px;">Facebook</a>
              <a href="#" style="color: #059669; text-decoration: none; margin: 0 8px; font-size: 13px;">Instagram</a>
              <a href="#" style="color: #059669; text-decoration: none; margin: 0 8px; font-size: 13px;">Twitter</a>
            </p>
            <p style="color: #9ca3af; margin: 15px 0 0; font-size: 11px;">
              © ${new Date().getFullYear()} Altuvera Safaris. All rights reserved.<br>
              Nairobi, Kenya
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    console.log('📤 Sending admin email...');
    
    // Send admin email
    const adminResult = await transporter.sendMail({
      from: '"Altuvera Safaris" <fabriceigiraneza36@gmail.com>',
      to: 'fabriceigiraneza36@gmail.com',
      subject: `🦒 New Safari Inquiry: ${subject}`,
      html: adminEmailHtml,
      replyTo: email
    });
    
    console.log('✅ Admin email sent:', adminResult.messageId);
    console.log('📤 Sending customer confirmation email...');
    
    // Send customer confirmation
    const customerResult = await transporter.sendMail({
      from: '"Altuvera Safaris" <fabriceigiraneza36@gmail.com>',
      to: email,
      subject: 'Thank You for Contacting Altuvera Safaris! 🌍',
      html: customerEmailHtml
    });
    
    console.log('✅ Customer email sent:', customerResult.messageId);
    console.log('🎉 All emails sent successfully!\n');

    res.status(200).json({
      success: true,
      message: 'Your message has been sent successfully! Check your email for confirmation.'
    });

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    console.error('Stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to send message. Please try again later.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.url}`);
  res.status(404).json({ 
    success: false, 
    message: `Endpoint not found: ${req.method} ${req.url}` 
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error' 
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📧 Contact endpoint: POST http://localhost:${PORT}/api/contact`);
  console.log(`❤️ Health check: GET http://localhost:${PORT}/api/health`);
  console.log('========================================\n');
});