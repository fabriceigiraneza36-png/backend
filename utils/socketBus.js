// backend/utils/socketBus.js - Fixed to properly store and retrieve IO instance
let ioInstance = null;

module.exports = {
  setIO: (io) => {
    ioInstance = io;
  },
  getIO: () => {
    return ioInstance;
  }
};