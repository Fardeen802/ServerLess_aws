const winston = require('winston');

// Configure logger based on environment
const logLevel = process.env.LOG_LEVEL || 'info';
const isDevelopment = process.env.NODE_ENV === 'development';

// Create custom format for development
const developmentFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    if (stack) {
      log += `\n${stack}`;
    }
    return log;
  })
);

// Create custom format for production
const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: logLevel,
  format: isDevelopment ? developmentFormat : productionFormat,
  defaultMeta: { 
    service: 'chat-app',
    environment: process.env.NODE_ENV || 'development',
    stage: process.env.STAGE || 'dev'
  },
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true
    })
  ],
  exitOnError: false
});

// Add request ID tracking for better debugging
logger.addRequestId = (requestId) => {
  return logger.child({ requestId });
};

// Add session tracking
logger.addSession = (sessionId) => {
  return logger.child({ sessionId });
};

// Performance logging helper
logger.performance = (operation, duration, metadata = {}) => {
  logger.info('Performance metric', {
    operation,
    duration,
    ...metadata
  });
};

// Security logging helper
logger.security = (event, metadata = {}) => {
  logger.warn('Security event', {
    event,
    ...metadata
  });
};

module.exports = logger; 