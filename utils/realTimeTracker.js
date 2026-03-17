/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * REAL-TIME TRACKING SYSTEM
 * ═══════════════════════════════════════════════════════════════════════════════
 * Tracks all uploads, API calls, and events in real-time for monitoring
 */

const logger = require("./logger");
const EventEmitter = require("events");

class RealTimeTracker extends EventEmitter {
  constructor() {
    super();
    this.uploads = new Map();
    this.apiCalls = new Map();
    this.events = [];
    this.maxEvents = 1000;
    this.startTime = Date.now();
  }

  // Track upload progress
  trackUploadStart(uploadId, metadata) {
    const uploadRecord = {
      id: uploadId,
      startTime: Date.now(),
      status: "started",
      ...metadata,
    };

    this.uploads.set(uploadId, uploadRecord);
    this.emit("upload:start", uploadRecord);

    logger.debug(`📤 Upload started: ${uploadId}`, {
      filename: metadata.filename,
      size: metadata.size,
    });

    return uploadRecord;
  }

  trackUploadProgress(uploadId, progress) {
    const upload = this.uploads.get(uploadId);
    if (!upload) return;

    upload.progress = progress;
    upload.lastUpdate = Date.now();

    this.emit("upload:progress", { id: uploadId, progress });
  }

  trackUploadComplete(uploadId, result) {
    const upload = this.uploads.get(uploadId);
    if (!upload) return;

    upload.status = "completed";
    upload.endTime = Date.now();
    upload.duration = upload.endTime - upload.startTime;
    upload.result = result;

    this.emit("upload:complete", upload);

    logger.info(`✅ Upload completed: ${uploadId}`, {
      duration: upload.duration,
      url: result.secure_url,
    });

    // Clean up old uploads from memory
    setTimeout(() => {
      this.uploads.delete(uploadId);
    }, 300000); // Remove after 5 minutes

    return upload;
  }

  trackUploadError(uploadId, error) {
    const upload = this.uploads.get(uploadId);
    if (!upload) return;

    upload.status = "failed";
    upload.endTime = Date.now();
    upload.duration = upload.endTime - upload.startTime;
    upload.error = error.message;

    this.emit("upload:error", upload);

    logger.error(`❌ Upload failed: ${uploadId}`, {
      error: error.message,
      duration: upload.duration,
    });

    return upload;
  }

  // Track API calls
  trackAPICall(method, path, statusCode, duration) {
    const callId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const callRecord = {
      id: callId,
      method,
      path,
      statusCode,
      duration,
      timestamp: new Date().toISOString(),
    };

    this.apiCalls.set(callId, callRecord);
    this.emit("api:call", callRecord);

    logger.debug(`📡 API Call: ${method} ${path} - ${statusCode} (${duration}ms)`);

    // Keep only recent API calls
    if (this.apiCalls.size > 500) {
      const firstKey = this.apiCalls.keys().next().value;
      this.apiCalls.delete(firstKey);
    }

    return callRecord;
  }

  // Track custom events
  trackEvent(type, data = {}) {
    const event = {
      type,
      data,
      timestamp: Date.now(),
      iso: new Date().toISOString(),
    };

    this.events.push(event);
    this.emit(`event:${type}`, event);

    logger.debug(`📍 Event tracked: ${type}`, data);

    // Keep only recent events
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    return event;
  }

  // Get tracker statistics
  getStats() {
    const now = Date.now();
    const uptime = now - this.startTime;

    return {
      uptime: `${(uptime / 1000 / 60).toFixed(2)} minutes`,
      uploads: {
        total: this.uploads.size,
        completed: Array.from(this.uploads.values()).filter(
          (u) => u.status === "completed"
        ).length,
        failed: Array.from(this.uploads.values()).filter(
          (u) => u.status === "failed"
        ).length,
        inProgress: Array.from(this.uploads.values()).filter(
          (u) => u.status === "started"
        ).length,
      },
      apiCalls: this.apiCalls.size,
      events: this.events.length,
      timestamp: new Date().toISOString(),
    };
  }

  // Get recent uploads
  getRecentUploads(limit = 10) {
    return Array.from(this.uploads.values())
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
      .slice(0, limit);
  }

  // Get recent API calls
  getRecentAPICalls(limit = 10) {
    const calls = Array.from(this.apiCalls.values());
    return calls
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  // Get recent events
  getRecentEvents(limit = 20) {
    return this.events.slice(-limit).reverse();
  }

  // Clear all tracking data
  clear() {
    this.uploads.clear();
    this.apiCalls.clear();
    this.events = [];
    logger.info("🧹 Real-time tracking data cleared");
  }
}

module.exports = new RealTimeTracker();
