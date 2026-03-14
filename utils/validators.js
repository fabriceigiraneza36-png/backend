exports.validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

exports.validateName = (name) => {
  return name && name.trim().length >= 2 && name.trim().length <= 50;
};

exports.validateBookingNumber = (bookingNumber) => {
  return /^[A-Z0-9]{8,12}$/.test(bookingNumber);
};

exports.validatePassword = (password) => {
  if (typeof password !== "string") return false;
  const trimmed = password.trim();
  if (trimmed.length < 10) return false;

  const hasUpper = /[A-Z]/.test(trimmed);
  const hasLower = /[a-z]/.test(trimmed);
  const hasDigit = /[0-9]/.test(trimmed);
  const hasSpecial = /[^A-Za-z0-9]/.test(trimmed);

  return hasUpper && hasLower && hasDigit && hasSpecial;
};