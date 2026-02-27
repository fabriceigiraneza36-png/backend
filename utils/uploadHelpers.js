const getUploadedFileUrl = (file) => {
  if (!file) return null;
  return file.secure_url || file.path || file.url || null;
};

module.exports = {
  getUploadedFileUrl,
};
