const messageStore = require('../services/messageStore');

const whatsappController = {
  /**
   * POST /api/whatsapp/register-user
   * Register a user's phone to track incoming admin messages
   */
  registerUser: (req, res) => {
    try {
      const { userPhone, adminPhone } = req.body;

      if (!userPhone) {
        return res.status(400).json({
          success: false,
          error: 'userPhone is required',
        });
      }

      const result = messageStore.registerUser(
        userPhone,
        adminPhone || process.env.ADMIN_PHONE
      );

      console.log(`[Controller] User registered: ${userPhone}`);

      return res.status(200).json({
        success: true,
        data: result,
        message: 'User registered for notifications',
      });
    } catch (error) {
      console.error('[Controller] Register error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to register user',
      });
    }
  },

  /**
   * GET /api/whatsapp/messages?userPhone=XXX&since=timestamp
   * Get new messages for a registered user
   */
  getMessages: (req, res) => {
    try {
      const { userPhone, since } = req.query;

      if (!userPhone) {
        return res.status(400).json({
          success: false,
          error: 'userPhone query parameter is required',
        });
      }

      const messages = messageStore.getMessages(userPhone, since || 0);
      const unreadCount = messageStore.getUnreadCount(userPhone);

      return res.status(200).json({
        success: true,
        messages,
        unreadCount,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[Controller] Get messages error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch messages',
      });
    }
  },

  /**
   * POST /api/whatsapp/mark-read
   * Mark all messages as read for a user
   */
  markAsRead: (req, res) => {
    try {
      const { userPhone } = req.body;

      if (!userPhone) {
        return res.status(400).json({
          success: false,
          error: 'userPhone is required',
        });
      }

      messageStore.markAsRead(userPhone);

      return res.status(200).json({
        success: true,
        message: 'Messages marked as read',
      });
    } catch (error) {
      console.error('[Controller] Mark read error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to mark messages as read',
      });
    }
  },

  /**
   * GET /api/whatsapp/webhook
   * Meta webhook verification (GET request)
   */
  verifyWebhook: (req, res) => {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      console.log('[Webhook] Verification request received');
      console.log('[Webhook] Mode:', mode);
      console.log('[Webhook] Token:', token);

      if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log('[Webhook] ✅ Verification successful');
        return res.status(200).send(challenge);
      }

      console.log('[Webhook] ❌ Verification failed');
      return res.status(403).json({ error: 'Verification failed' });
    } catch (error) {
      console.error('[Webhook] Verification error:', error);
      return res.status(500).json({ error: 'Server error' });
    }
  },

  /**
   * POST /api/whatsapp/webhook
   * Receive incoming WhatsApp messages from Meta
   * This is where admin replies get captured
   */
  handleWebhook: (req, res) => {
    try {
      const body = req.body;

      console.log('[Webhook] 📩 Incoming webhook payload');
      console.log(JSON.stringify(body, null, 2));

      // Always respond 200 quickly (Meta requires fast response)
      res.status(200).send('EVENT_RECEIVED');

      // Process the webhook asynchronously
      if (body.object === 'whatsapp_business_account') {
        body.entry?.forEach(entry => {
          entry.changes?.forEach(change => {
            const value = change.value;

            // Handle incoming messages
            if (value.messages) {
              value.messages.forEach(message => {
                const fromPhone = message.from; // Sender's phone
                const contactName = value.contacts?.[0]?.profile?.name || 'Unknown';

                console.log(`[Webhook] Message from ${contactName} (${fromPhone})`);
                console.log(`[Webhook] Type: ${message.type}`);

                // Determine message content based on type
                let messageBody = '';
                switch (message.type) {
                  case 'text':
                    messageBody = message.text?.body || '';
                    break;
                  case 'image':
                    messageBody = '📷 Image received';
                    break;
                  case 'video':
                    messageBody = '🎥 Video received';
                    break;
                  case 'audio':
                    messageBody = '🎵 Audio received';
                    break;
                  case 'document':
                    messageBody = `📄 Document: ${message.document?.filename || 'file'}`;
                    break;
                  case 'location':
                    messageBody = '📍 Location shared';
                    break;
                  case 'sticker':
                    messageBody = '🎨 Sticker';
                    break;
                  default:
                    messageBody = `[${message.type}]`;
                }

                console.log(`[Webhook] Content: ${messageBody}`);

                // Check if this is FROM the admin
                const adminPhone = process.env.ADMIN_PHONE;
                const isFromAdmin = fromPhone.includes(adminPhone) ||
                                   adminPhone.includes(fromPhone.slice(-9));

                if (isFromAdmin) {
                  // Admin sent a message — find which user it's for
                  // In WhatsApp Business API, we need to check the recipient
                  // For now, broadcast to all registered users or use metadata
                  console.log('[Webhook] ✅ Message is FROM admin');

                  // If the message has a context (reply), find the original user
                  const recipientPhone = message.context?.from || null;

                  if (recipientPhone) {
                    // Direct reply to a user
                    messageStore.addMessage(recipientPhone, fromPhone, {
                      id: message.id,
                      fromName: contactName,
                      body: messageBody,
                      type: message.type,
                      timestamp: message.timestamp,
                    });
                  } else {
                    // Broadcast to all registered users (or handle differently)
                    const users = messageStore.getAllUsers();
                    users.forEach(user => {
                      messageStore.addMessage(user.phone, fromPhone, {
                        id: `${message.id}_${user.phone}`,
                        fromName: contactName,
                        body: messageBody,
                        type: message.type,
                        timestamp: message.timestamp,
                      });
                    });
                  }
                } else {
                  // Message FROM a user TO admin
                  // Store as incoming (could be useful for tracking)
                  console.log(`[Webhook] Message from user ${fromPhone} to admin`);

                  // Auto-register the user if not already registered
                  if (!messageStore.isRegistered(fromPhone)) {
                    messageStore.registerUser(fromPhone, adminPhone);
                    console.log(`[Webhook] Auto-registered user: ${fromPhone}`);
                  }
                }
              });
            }

            // Handle message status updates (sent, delivered, read)
            if (value.statuses) {
              value.statuses.forEach(status => {
                console.log(`[Webhook] Status update: ${status.id} → ${status.status}`);
              });
            }
          });
        });
      }
    } catch (error) {
      console.error('[Webhook] Processing error:', error);
      // Still return 200 to prevent Meta from retrying
      if (!res.headersSent) {
        res.status(200).send('EVENT_RECEIVED');
      }
    }
  },

  /**
   * GET /api/whatsapp/users
   * Get all registered users (admin endpoint)
   */
  getUsers: (req, res) => {
    try {
      const users = messageStore.getAllUsers();
      const stats = messageStore.getStats();

      return res.status(200).json({
        success: true,
        users,
        stats,
      });
    } catch (error) {
      console.error('[Controller] Get users error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch users',
      });
    }
  },

  /**
   * POST /api/whatsapp/simulate-message
   * For testing: Simulate an admin message to a user
   */
  simulateMessage: (req, res) => {
    try {
      const { userPhone, message } = req.body;

      if (!userPhone || !message) {
        return res.status(400).json({
          success: false,
          error: 'userPhone and message are required',
        });
      }

      const result = messageStore.addMessage(
        userPhone,
        process.env.ADMIN_PHONE,
        {
          id: `sim_${Date.now()}`,
          fromName: 'IGIRANEZA Fabrice',
          body: message,
          type: 'text',
          timestamp: Math.floor(Date.now() / 1000),
        }
      );

      if (!result) {
        return res.status(404).json({
          success: false,
          error: 'User not found. Register the user first.',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Simulated message sent',
        data: result,
      });
    } catch (error) {
      console.error('[Controller] Simulate error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to simulate message',
      });
    }
  },

  /**
   * GET /api/whatsapp/health
   * Health check endpoint
   */
  healthCheck: (req, res) => {
    const stats = messageStore.getStats();
    return res.status(200).json({
      status: 'ok',
      service: 'WhatsApp Notification Service',
      timestamp: new Date().toISOString(),
      stats,
    });
  },
};

module.exports = whatsappController;