"use strict";

const { query } = require("../config/db");
const logger = require("./logger");

/**
 * Create a personalised, deep-linked in-app/push notification for each member
 * of a message group except the traveller who sent the message.
 *
 * Email is deliberately suppressed for chat traffic; the in-app notification,
 * realtime event and configured web-push channel are still used.
 */
async function notifyGroupMembersOfMessage({
  groupId,
  conversationId,
  groupName,
  message,
  senderId = null,
  senderType = "user",
} = {}) {
  if (groupId == null || conversationId == null || !message) return;

  try {
    const { rows: members } = await query(
      `SELECT gm.user_id, u.email
         FROM message_group_members gm
         LEFT JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = $1`,
      [groupId],
    );
    if (!members.length) return;

    const senderKind = String(senderType || message.senderType || message.sender_type || "user")
      .trim().toLowerCase().replace(/[\\s-]+/g, "_");
    const isTravellerSender = ["user", "traveller", "traveler"].includes(senderKind);
    const actualSenderId = senderId ?? message.senderId ?? message.sender_id ?? null;
    const senderName = String(
      message.senderName || message.sender_name ||
      (senderKind === "admin" ? "Altuvera Team" : "A group member"),
    ).trim() || "A group member";
    const senderAvatar = message.senderAvatar || message.sender_avatar || message.avatarUrl || null;
    const senderUsername = message.senderUsername || message.sender_username || null;
    const body = String(message.body || message.message || "").trim();
    const cleanGroupName = String(groupName || "Group conversation").trim();
    const groupConversationId = String(conversationId);

    const recipients = members.filter((member) => !(
      isTravellerSender &&
      actualSenderId != null &&
      String(member.user_id) === String(actualSenderId)
    ));
    if (!recipients.length) return;

    const { createNotificationInternal } = require("../controllers/notificationsController");
    await Promise.allSettled(recipients.map((member) => createNotificationInternal({
      userId: member.user_id,
      userEmail: member.email || null,
      senderType: senderKind,
      senderId: actualSenderId,
      senderName,
      type: "group_message_received",
      category: "message",
      title: `${senderName} sent a message in ${cleanGroupName}`,
      message: body ? `${cleanGroupName}: ${body}`.slice(0, 500) : `New message in ${cleanGroupName}.`,
      actionUrl: `/messages?conversationId=${encodeURIComponent(groupConversationId)}`,
      actionLabel: "Open group",
      priority: "normal",
      targetScope: "individual",
      skipUserEmail: true,
      metadata: {
        conversationId: conversationId,
        groupId,
        groupName: cleanGroupName,
        messageId: message.id || message.messageId || null,
        senderId: actualSenderId,
        senderName,
        senderUsername,
        senderAvatar,
      },
    })));
  } catch (error) {
    logger.warn("[Messages] Group-member notifications failed:", error.message);
  }
}

module.exports = notifyGroupMembersOfMessage;
