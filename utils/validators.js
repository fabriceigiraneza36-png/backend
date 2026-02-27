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