// utils/socketBus.js
// ─── Singleton IO instance shared across modules ───────────────────────────
let _io = null

module.exports = {
  setIO: (io) => { _io = io },
  getIO: ()   => _io,

  // ── Convenience emitters ─────────────────────────────────────────────────

  /** Emit to all admins */
  toAdmins: (event, data) => {
    if (_io) _io.to('admins').emit(event, data)
  },

  /** Emit to a specific conversation room */
  toConversation: (convId, event, data) => {
    if (_io) _io.to(`conv:${convId}`).emit(event, data)
  },

  /** Emit to a session room (user-side) */
  toSession: (sessionId, event, data) => {
    if (_io) _io.to(`session:${sessionId}`).emit(event, data)
  },

  /** Broadcast new booking notification to admins */
  newBooking: (booking) => {
    if (_io) _io.to('admins').emit('new-booking', booking)
  },

  /** Broadcast new contact message to admins */
  newContact: (msg) => {
    if (_io) _io.to('admins').emit('new-contact-message', msg)
  },
}