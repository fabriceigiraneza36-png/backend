/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FRONTEND CONTACT MESSAGE UTILITY
 * Utility for sending contact messages to Altuvera Travel backend
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Send contact message to backend without email verification
 * @param {Object} data - Contact form data
 * @param {string} data.name - Full name (alternative to full_name)
 * @param {string} data.full_name - Full name
 * @param {string} data.email - Email address
 * @param {string} [data.phone] - Phone number
 * @param {string} [data.subject] - Message subject
 * @param {string} data.message - Message content
 * @param {string} [data.tripType] - Trip type (alternative to trip_type)
 * @param {string} [data.trip_type] - Trip type
 * @param {string} [data.travelDate] - Travel date (alternative to travel_date)
 * @param {string} [data.travel_date] - Travel date
 * @param {number} [data.travelers] - Number of travelers (alternative to number_of_travelers)
 * @param {number} [data.number_of_travelers] - Number of travelers
 * @returns {Promise<Object>} Response from backend
 */
async function sendContactMessage(data) {
  // Construct payload with normalized field names
  const payload = {
    full_name: data.name || data.full_name,
    email: data.email,
    phone: data.phone || null,
    subject: data.subject || null,
    message: data.message,
    trip_type: data.tripType || data.trip_type || null,
    travel_date: data.travelDate || data.travel_date || null,
    number_of_travelers: data.travelers || data.number_of_travelers || null,
    source: 'website',
  };

  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to send message');
    }

    return result;
  } catch (error) {
    console.error('Contact form submission error:', error);
    throw error;
  }
}

/**
 * Example usage:
 *
 * const contactData = {
 *   name: 'John Doe',
 *   email: 'john@example.com',
 *   phone: '+1234567890',
 *   subject: 'Gorilla Trekking Inquiry',
 *   message: 'I am interested in booking a gorilla trekking tour...',
 *   tripType: 'gorilla-trekking',
 *   travelDate: '2024-08-15',
 *   travelers: 3
 * };
 *
 * try {
 *   const response = await sendContactMessage(contactData);
 *   console.log('Message sent successfully:', response);
 * } catch (error) {
 *   console.error('Failed to send message:', error);
 * }
 */

module.exports = { sendContactMessage };

// For browser usage (if not using modules)
if (typeof window !== 'undefined') {
  window.sendContactMessage = sendContactMessage;
}