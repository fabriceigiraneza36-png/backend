let io = null;

module.exports = {
  setIO: (socketServer) => {
    io = socketServer;
  },
  getIO: () => io,
};
