if (process.env.SENDGRID_API_KEY) {
    try {
      const result = await sendGridSend({
        to,
        subject,
        html,
        text: plainText,
        ...(cc      ? { cc }      : {}),
        ...(replyTo ? { replyTo } : {}),
      });
      logger.info(`[Email] ✅ SendGrid delivered → ${to} | msgId: ${result.messageId || 'unknown'}`);
      return result;
    } catch (sendErr) {
      logger.warn(`[Email] SendGrid failed, falling back to Resend: ${sendErr.message}`);
    }
  }