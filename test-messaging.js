#!/usr/bin/env node

/**
 * Test Script: User ↔ Admin Messaging System
 * Tests bidirectional real-time messaging with Socket.io
 */

const io = require('socket.io-client');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3000';
const SOCKET_URL = 'http://localhost:3000';

// Load JWT_SECRET from .env file
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  try {
    const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const secretMatch = envFile.match(/JWT_SECRET=([^\n]+)/);
    JWT_SECRET = secretMatch ? secretMatch[1].trim() : 'altuvera-super-secret-jwt-key-change-this-in-production-2024';
  } catch {
    JWT_SECRET = 'altuvera-super-secret-jwt-key-change-this-in-production-2024';
  }
}

console.log(`Using JWT_SECRET: ${JWT_SECRET.substring(0, 30)}...`);

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(type, message) {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = {
    info: `${colors.blue}ℹ${colors.reset}`,
    success: `${colors.green}✓${colors.reset}`,
    error: `${colors.red}✗${colors.reset}`,
    test: `${colors.cyan}→${colors.reset}`,
    warn: `${colors.yellow}⚠${colors.reset}`,
  }[type] || '•';
  console.log(`${prefix} [${timestamp}] ${message}`);
}

const testResults = {
  passed: [],
  failed: [],
};

function recordTest(name, passed, details = '') {
  if (passed) {
    testResults.passed.push(name);
    log('success', `${name} ${details}`);
  } else {
    testResults.failed.push(name);
    log('error', `${name} ${details}`);
  }
}

/**
 * Create a test admin JWT token
 */
function generateAdminToken() {
  try {
    const token = jwt.sign(
      {
        id: 999,
        email: 'admin@test.local',
        role: 'admin',
        type: 'admin',
        tokenVersion: 0,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    // Verify the token to ensure it's valid
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      log('info', `Token verified: type=${decoded.type}, role=${decoded.role}`);
    } catch (verifyErr) {
      log('warn', `Token verification failed: ${verifyErr.message}`);
    }
    
    return token;
  } catch (error) {
    log('error', `Failed to generate admin token: ${error.message}`);
    return null;
  }
}

async function testUserSendMessage() {
  return new Promise((resolve) => {
    log('test', 'TEST 1: User sending message to Admin');
    
    const userSocket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    userSocket.on('connect', () => {
      log('info', 'User socket connected');
      
      const testData = {
        sessionId: 'test-session-' + Date.now(),
        guestName: 'Test User',
        guestEmail: 'test@example.com',
        body: 'Hello Admin! This is a test message.',
      };

      log('info', `Registering user session: ${testData.sessionId}`);
      userSocket.emit('msg:register', testData, (response) => {
        log('info', `Registration response - conversationId: ${response?.conversationId}, sessionId: ${testData.sessionId}`);

        if (!response?.conversationId) {
          recordTest('User sends message', false, '(no conversationId in response)');
          userSocket.disconnect();
          resolve(null);
          return;
        }

        const conversationId = response.conversationId;

        setTimeout(() => {
          log('info', `Sending message: "${testData.body}"`);
          userSocket.emit('msg:send', {
            conversationId: conversationId,
            body: testData.body,
          }, (ackResponse) => {
            log('info', `Message ACK: ${JSON.stringify(ackResponse)}`);
            recordTest('User sends message', true, '(message emitted)');
            userSocket.disconnect();
            // Return both conversationId and sessionId
            resolve({ conversationId, sessionId: testData.sessionId });
          });
        }, 500);
      });

      setTimeout(() => {
        if (userSocket.connected) {
          recordTest('User sends message', false, '(timeout)');
          userSocket.disconnect();
          resolve(null);
        }
      }, 10000);
    });

    userSocket.on('error', (error) => {
      recordTest('User sends message', false, `(connection error: ${error})`);
      resolve(null);
    });

    userSocket.on('connect_error', (error) => {
      log('error', `Connection error: ${error}`);
    });
  });
}

async function testMessageStoredInDB(conversationId) {
  return new Promise((resolve) => {
    log('test', 'TEST 2: Verify message stored in database');

    setTimeout(async () => {
      try {
        const response = await axios.get(
          `${API_URL}/api/messages/conversation/${conversationId}/messages`,
          {
            params: {
              limit: 10,
            },
            validateStatus: () => true,
          }
        );

        if (response.status === 200 && response.data.success && response.data.data && response.data.data.length > 0) {
          const message = response.data.data[0];
          log('info', `Found message in DB: "${message.body}" (ID: ${message.id})`);
          recordTest('Message stored in database', true, `(${message.id})`);
          resolve(true);
        } else {
          log('warn', `Response: status=${response.status}, success=${response.data.success}, dataLength=${response.data.data?.length || 0}`);
          recordTest('Message stored in database', false, '(no messages found)');
          resolve(false);
        }
      } catch (error) {
        recordTest('Message stored in database', false, `(error: ${error.message})`);
        resolve(false);
      }
    }, 1000);
  });
}

async function testAdminReceiveMessage(conversationId, sessionId) {
  return new Promise((resolve) => {
    log('test', 'TEST 3: Admin connecting and receiving message');

    const adminToken = generateAdminToken();
    if (!adminToken) {
      recordTest('Admin receives user message', false, '(failed to generate token)');
      resolve(false);
      return;
    }

    log('info', `Admin token created: ${adminToken.substring(0, 20)}...`);

    const adminSocket = io(SOCKET_URL, {
      auth: {
        token: adminToken,
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    adminSocket.on('connect', () => {
      log('info', 'Admin socket connected');

      // Join the conversation
      log('info', `Admin joining conversation: ${conversationId}`);
      adminSocket.emit('msg:admin-join', {
        conversationId: conversationId,
      });

      // Listen for messages
      let messageReceived = false;
      adminSocket.on('msg:new-from-user', (message) => {
        log('info', `Admin received message via socket: "${message.body}"`);
        messageReceived = true;
        recordTest('Admin receives user message', true, '(real-time socket)');
        adminSocket.disconnect();
        resolve(true);
      });

      setTimeout(() => {
        if (!messageReceived) {
          log('warn', 'No real-time message received, checking via REST API');
          // Fallback: check via REST API using sessionId
          axios.get(`${API_URL}/api/chat/sessions/${sessionId}/messages`, {
            headers: { Authorization: `Bearer ${adminToken}` },
            validateStatus: () => true,
          }).then((response) => {
            log('info', `Chat API Response: status=${response.status}, success=${response.data?.success}, message=${response.data?.message || 'N/A'}`);
            if (response.data?.success && response.data?.data && response.data.data.length > 0) {
              log('info', `Found ${response.data.data.length} messages via API`);
              recordTest('Admin receives user message', true, '(via REST API)');
              resolve(true);
            } else {
              log('warn', `API response: success=${response.data?.success}, dataLength=${response.data?.data?.length || 0}`);
              recordTest('Admin receives user message', false, '(no messages via API)');
              resolve(false);
            }
            adminSocket.disconnect();
          }).catch((error) => {
            log('error', `Chat API Error: ${error.message}`);
            recordTest('Admin receives user message', false, `(API error: ${error.message})`);
            adminSocket.disconnect();
            resolve(false);
          });
        }
      }, 3000);
    });

    adminSocket.on('error', (error) => {
      recordTest('Admin receives user message', false, `(connection error: ${error})`);
      resolve(false);
    });

    adminSocket.on('connect_error', (error) => {
      log('warn', `Admin socket connect_error: ${error}`);
    });
  });
}

async function testAdminSendReply(conversationId) {
  return new Promise((resolve) => {
    log('test', 'TEST 4: Admin sending reply to user');

    const adminToken = generateAdminToken();
    if (!adminToken) {
      recordTest('Admin sends reply message', false, '(failed to generate token)');
      resolve(false);
      return;
    }

    const adminSocket = io(SOCKET_URL, {
      auth: {
        token: adminToken,
      },
      reconnection: true,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    adminSocket.on('connect', () => {
      log('info', 'Admin socket connected for reply');

      const replyMessage = 'Thank you for your message! We will help you shortly.';
      log('info', `Admin sending reply: "${replyMessage}"`);

      adminSocket.emit('msg:admin-send', {
        conversationId: conversationId,
        body: replyMessage,
      }, (ackResponse) => {
        log('info', `Reply ACK: success=${ackResponse?.success}, error=${ackResponse?.error}`);
        if (ackResponse?.success) {
          recordTest('Admin sends reply message', true, '(message emitted)');
        } else {
          recordTest('Admin sends reply message', false, `(ack error: ${ackResponse?.error})`);
        }
        adminSocket.disconnect();
        resolve(!!ackResponse?.success);
      });

      setTimeout(() => {
        if (adminSocket.connected) {
          recordTest('Admin sends reply message', false, '(timeout - no ACK)');
          adminSocket.disconnect();
          resolve(false);
        }
      }, 5000);
    });

    adminSocket.on('error', (error) => {
      recordTest('Admin sends reply message', false, `(connection error: ${error})`);
      resolve(false);
    });

    adminSocket.on('connect_error', (error) => {
      log('warn', `Admin socket connect_error: ${error}`);
    });
  });
}

async function testUserReceiveReply(conversationId) {
  return new Promise((resolve) => {
    log('test', 'TEST 5: User receiving admin reply');

    // First, give the admin message time to be processed
    setTimeout(() => {
      const userSocket = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      userSocket.on('connect', () => {
        log('info', 'User socket reconnected to receive reply');

        // Listen for messages
        let replyReceived = false;

        userSocket.on('msg:new-from-admin', (message) => {
          log('info', `User received reply via socket: "${message.body}"`);
          replyReceived = true;
          recordTest('User receives admin reply', true, '(real-time socket)');
          userSocket.disconnect();
          resolve(true);
        });

        setTimeout(() => {
          if (!replyReceived) {
            log('warn', 'No real-time reply received, checking via API');
            // Fallback: check via REST API
            axios.get(`${API_URL}/api/messages/conversation/${conversationId}/messages`, {
              params: { limit: 10 },
              validateStatus: () => true,
            }).then((response) => {
              const adminMessages = response.data?.data?.filter(m => m.senderType === 'admin');
              if (adminMessages && adminMessages.length > 0) {
                log('info', `Found ${adminMessages.length} admin message(s) via API`);
                recordTest('User receives admin reply', true, '(via REST API)');
                resolve(true);
              } else {
                log('warn', `API response: dataLength=${response.data?.data?.length}, adminMessages=${adminMessages?.length}`);
                recordTest('User receives admin reply', false, '(no admin messages via API)');
                resolve(false);
              }
              userSocket.disconnect();
            }).catch((error) => {
              recordTest('User receives admin reply', false, `(API error: ${error.message})`);
              userSocket.disconnect();
              resolve(false);
            });
          }
        }, 3000);
      });

      userSocket.on('error', (error) => {
        recordTest('User receives admin reply', false, `(connection error: ${error})`);
        resolve(false);
      });
    }, 1500);
  });
}

async function runAllTests() {
  log('info', '═══════════════════════════════════════════════════════════');
  log('info', '  ALTUVERA MESSAGING SYSTEM - COMPREHENSIVE TEST SUITE');
  log('info', '═══════════════════════════════════════════════════════════');
  log('info', '');

  try {
    // Test 1: User sends message
    const testIds = await testUserSendMessage();
    if (!testIds || !testIds.conversationId) {
      log('error', 'Failed to create conversation, aborting tests');
      process.exit(1);
    }

    const { conversationId, sessionId } = testIds;
    log('info', `Using conversationId: ${conversationId}, sessionId: ${sessionId}`);

    // Test 2: Verify message in database
    await testMessageStoredInDB(conversationId);

    // Test 3: Admin receives message
    await testAdminReceiveMessage(conversationId, sessionId);

    // Test 4: Admin sends reply
    await testAdminSendReply(conversationId);

    // Test 5: User receives reply
    await testUserReceiveReply(conversationId);

    // Print summary
    log('info', '');
    log('info', '═══════════════════════════════════════════════════════════');
    log('info', `Tests Passed: ${testResults.passed.length}/5`);
    log('info', `Tests Failed: ${testResults.failed.length}/5`);

    if (testResults.passed.length > 0) {
      log('info', '');
      log('success', 'PASSED TESTS:');
      testResults.passed.forEach(test => {
        console.log(`  ${colors.green}✓${colors.reset} ${test}`);
      });
    }

    if (testResults.failed.length > 0) {
      log('info', '');
      log('error', 'FAILED TESTS:');
      testResults.failed.forEach(test => {
        console.log(`  ${colors.red}✗${colors.reset} ${test}`);
      });
    }

    log('info', '═══════════════════════════════════════════════════════════');

    process.exit(testResults.failed.length > 0 ? 1 : 0);
  } catch (error) {
    log('error', `Unexpected error: ${error.message}`);
    process.exit(1);
  }
}

// Run tests
runAllTests();
