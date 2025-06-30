const logger = require('./logger');

// Appointment validation
function validateAppointmentData(appointmentData) {
  const errors = [];
  
  if (!appointmentData.name || appointmentData.name.trim().length < 2) {
    errors.push('Name must be at least 2 characters long');
  }
  
  if (!appointmentData.email || !isValidEmail(appointmentData.email)) {
    errors.push('Valid email is required');
  }
  
  if (!appointmentData.phone || appointmentData.phone.trim().length < 10) {
    errors.push('Valid phone number is required');
  }
  
  if (!appointmentData.service || appointmentData.service.trim().length === 0) {
    errors.push('Service type is required');
  }
  
  if (!appointmentData.preferredDate) {
    errors.push('Preferred date is required');
  }
  
  if (!appointmentData.preferredTime) {
    errors.push('Preferred time is required');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Extract appointment information from conversation
function extractAppointmentInfo(message) {
  const appointmentData = {};
  
  // Extract name
  const nameMatch = message.match(/(?:my name is|i'm|i am|call me)\s+([a-zA-Z\s]+)/i);
  if (nameMatch) {
    appointmentData.name = nameMatch[1].trim();
  }
  
  // Extract email
  const emailMatch = message.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (emailMatch) {
    appointmentData.email = emailMatch[1];
  }
  
  // Extract phone
  const phoneMatch = message.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
  if (phoneMatch) {
    appointmentData.phone = phoneMatch[1].replace(/[-.\s]/g, '');
  }
  
  // Extract service
  const serviceKeywords = ['consultation', 'checkup', 'examination', 'treatment', 'therapy', 'surgery'];
  for (const keyword of serviceKeywords) {
    if (message.toLowerCase().includes(keyword)) {
      appointmentData.service = keyword;
      break;
    }
  }
  
  // Extract date
  const dateMatch = message.match(/(?:on|for|at)\s+(\w+\s+\d{1,2}(?:st|nd|rd|th)?)/i);
  if (dateMatch) {
    appointmentData.preferredDate = dateMatch[1];
  }
  
  // Extract time
  const timeMatch = message.match(/(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
  if (timeMatch) {
    appointmentData.preferredTime = timeMatch[1];
  }
  
  return appointmentData;
}

// Generate appointment confirmation
function generateAppointmentConfirmation(appointmentData) {
  return {
    appointmentId: `APT-${Date.now()}`,
    status: 'confirmed',
    confirmationMessage: `Thank you ${appointmentData.name}! Your appointment has been confirmed for ${appointmentData.service} on ${appointmentData.preferredDate} at ${appointmentData.preferredTime}. We'll send a confirmation email to ${appointmentData.email} and call you at ${appointmentData.phone} if needed.`,
    appointmentData
  };
}

// Check appointment availability (mock function - replace with your API)
async function checkAvailability(date, time, service) {
  // This is a mock function - replace with your actual availability API
  const availableSlots = [
    '09:00 AM', '10:00 AM', '11:00 AM', '02:00 PM', '03:00 PM', '04:00 PM'
  ];
  
  const isAvailable = availableSlots.includes(time);
  
  return {
    available: isAvailable,
    alternativeSlots: isAvailable ? [] : availableSlots,
    message: isAvailable ? 'Slot is available' : 'Slot is not available, here are alternative times'
  };
}

// Create appointment (mock function - replace with your API)
async function createAppointment(appointmentData) {
  try {
    // This is a mock function - replace with your actual appointment creation API
    const appointment = {
      id: `APT-${Date.now()}`,
      ...appointmentData,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    logger.info('Appointment created:', appointment.id);
    return appointment;
  } catch (error) {
    logger.error('Error creating appointment:', error);
    throw error;
  }
}

// Get available services
function getAvailableServices() {
  return [
    { id: 'consultation', name: 'General Consultation', duration: 30 },
    { id: 'checkup', name: 'Health Checkup', duration: 45 },
    { id: 'examination', name: 'Physical Examination', duration: 60 },
    { id: 'treatment', name: 'Treatment Session', duration: 45 },
    { id: 'therapy', name: 'Therapy Session', duration: 60 },
    { id: 'surgery', name: 'Surgical Consultation', duration: 90 }
  ];
}

// Get available time slots
function getAvailableTimeSlots() {
  return [
    '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
    '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM'
  ];
}

// Format appointment data for display
function formatAppointmentData(appointmentData) {
  return {
    name: appointmentData.name || 'Not provided',
    email: appointmentData.email || 'Not provided',
    phone: appointmentData.phone || 'Not provided',
    service: appointmentData.service || 'Not specified',
    date: appointmentData.preferredDate || 'Not specified',
    time: appointmentData.preferredTime || 'Not specified'
  };
}

module.exports = {
  validateAppointmentData,
  extractAppointmentInfo,
  generateAppointmentConfirmation,
  checkAvailability,
  createAppointment,
  getAvailableServices,
  getAvailableTimeSlots,
  formatAppointmentData
}; 