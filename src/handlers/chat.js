const { getCollection } = require('../utils/database');
const { OpenAI } = require('openai');
const logger = require('../utils/logger');
const AWSXRay = require('aws-xray-sdk-core');
const { 
  storeConversationEmbedding, 
  searchRelevantContext, 
  searchAppointmentInfo,
  searchClinicInfo,
  getConversationHistory 
} = require('../utils/pinecone');
const { 
  extractAppointmentInfo, 
  validateAppointmentData, 
  generateAppointmentConfirmation,
  createAppointment,
  getAvailableServices,
  getAvailableTimeSlots
} = require('../utils/appointment');

// Initialize X-Ray
AWSXRay.captureHTTPsGlobal(require('https'));
AWSXRay.captureHTTPsGlobal(require('http'));

// Initialize OpenAI with proper error handling
let openai;
try {
  openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 30000, // 30 seconds timeout
    maxRetries: 3
  });
} catch (error) {
  logger.error('OpenAI initialization error:', error);
}

// Simple in-memory cache for session data (will be cleared on cold start)
const sessionCache = new Map();

// Rate limiting cache
const rateLimitCache = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute

function isRateLimited(sessionId) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!rateLimitCache.has(sessionId)) {
    rateLimitCache.set(sessionId, []);
  }
  
  const requests = rateLimitCache.get(sessionId);
  const recentRequests = requests.filter(time => time > windowStart);
  
  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }
  
  recentRequests.push(now);
  rateLimitCache.set(sessionId, recentRequests);
  return false;
}

function validateInput(sessionId, message) {
  if (!sessionId || typeof sessionId !== 'string') {
    return { valid: false, error: 'sessionId must be a non-empty string' };
  }
  
  if (!message || typeof message !== 'string') {
    return { valid: false, error: 'message must be a non-empty string' };
  }
  
  if (sessionId.length > 100) {
    return { valid: false, error: 'sessionId too long (max 100 characters)' };
  }
  
  if (message.length > 4000) {
    return { valid: false, error: 'message too long (max 4000 characters)' };
  }
  
  return { valid: true };
}

async function getSessionHistory(sessionId) {
  // Check cache first
  if (sessionCache.has(sessionId)) {
    return sessionCache.get(sessionId);
  }
  
  try {
    const chatsCollection = await getCollection('chats');
    const history = await chatsCollection
      .find({ sessionId })
      .sort({ createdAt: 1 })
      .limit(50) // Limit to last 50 messages for performance
      .toArray();
    
    // Cache the result
    sessionCache.set(sessionId, history);
    return history;
  } catch (error) {
    logger.error('Error fetching session history:', error);
    throw error;
  }
}

async function saveMessage(sessionId, role, content) {
  try {
    const chatsCollection = await getCollection('chats');
    const message = {
      sessionId,
      role,
      content,
      createdAt: new Date()
    };
    
    await chatsCollection.insertOne(message);
    
    // Update cache
    if (sessionCache.has(sessionId)) {
      const history = sessionCache.get(sessionId);
      history.push(message);
      // Keep only last 50 messages in cache
      if (history.length > 50) {
        history.splice(0, history.length - 50);
      }
      sessionCache.set(sessionId, history);
    }
    
    return message;
  } catch (error) {
    logger.error('Error saving message:', error);
    throw error;
  }
}

module.exports.handler = async (event) => {
  const startTime = Date.now();
  const segment = AWSXRay.getSegment();
  
  try {
    logger.info('Chat request received', {
      sessionId: event.body ? JSON.parse(event.body).sessionId : 'unknown',
      httpMethod: event.httpMethod,
      userAgent: event.headers?.['User-Agent'] || 'unknown'
    });

    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    // Validate HTTP method
    if (event.httpMethod !== 'POST') {
      logger.warn('Invalid HTTP method', { method: event.httpMethod });
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    // Parse request body
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (error) {
      logger.warn('Invalid JSON in request body', { error: error.message });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    const { sessionId, message } = body;

    // Validate input
    const validation = validateInput(sessionId, message);
    if (!validation.valid) {
      logger.warn('Input validation failed', { 
        sessionId, 
        error: validation.error,
        messageLength: message?.length 
      });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: validation.error })
      };
    }

    // Check rate limiting
    if (isRateLimited(sessionId)) {
      logger.warn('Rate limit exceeded', { sessionId });
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ 
          error: 'Rate limit exceeded. Please wait before sending another message.',
          retryAfter: 60
        })
      };
    }

    // Check OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      logger.error('OpenAI API key not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'OpenAI API key not configured' })
      };
    }

    // Save user message
    const userMessage = await saveMessage(sessionId, 'user', message);
    logger.debug('User message saved', { sessionId, messageId: userMessage._id });

    // Generate embeddings for both indexes
    const [embedding3072Response, embedding1536Response] = await Promise.all([
      openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: message
      }),
      openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: message
      })
    ]);
    
    const embedding3072 = embedding3072Response.data[0].embedding;
    const embedding1536 = embedding1536Response.data[0].embedding;

    // Store conversation embedding in Pinecone
    await storeConversationEmbedding(sessionId, message, embedding3072);

    // Extract appointment information from the message
    const extractedAppointmentInfo = extractAppointmentInfo(message);
    const hasAppointmentInfo = Object.keys(extractedAppointmentInfo).length > 0;

    // Get conversation history from Pinecone for better context
    const conversationHistory = await getConversationHistory(sessionId, 10);
    
    // Search for relevant context from previous conversations
    const relevantContext = await searchRelevantContext(embedding3072, sessionId, 3);
    
    // Search for appointment-related information
    const appointmentInfo = await searchAppointmentInfo(embedding3072, 2, 'appointment-chatbot');

    // Search for clinic information
    const clinicInfo = await searchClinicInfo(embedding1536, 2, 'kanses-primary-urgent');

    // Prepare context for the AI
    let contextPrompt = '';
    if (relevantContext.length > 0) {
      contextPrompt += '\n\nPrevious conversation context:\n';
      relevantContext.forEach(match => {
        contextPrompt += `- ${match.metadata.message}\n`;
      });
    }

    if (appointmentInfo.length > 0) {
      contextPrompt += '\n\nRelevant appointment information:\n';
      appointmentInfo.forEach(match => {
        contextPrompt += `- ${JSON.stringify(match.metadata)}\n`;
      });
    }

    if (clinicInfo.length > 0) {
      contextPrompt += '\n\nRelevant clinic information:\n';
      clinicInfo.forEach(match => {
        contextPrompt += `- ${match.metadata.text}\n`;
      });
    }
    
    // Get available services and time slots
    // const availableServices = getAvailableServices();
    // const availableTimeSlots = getAvailableTimeSlots();

    // Prepare system prompt for appointment booking
    const systemPrompt = `You are an AI appointment booking assistant for a healthcare facility. Your role is to help users book appointments by collecting necessary information and providing helpful responses.



${contextPrompt}

Current appointment information collected: ${JSON.stringify(extractedAppointmentInfo)}

Instructions:
1. Be friendly and professional
2. Help collect missing appointment information (name, email, phone, service, date, time)
3. If all information is collected, offer to confirm the appointment
4. Provide available services and time slots when asked
5. Keep responses concise and helpful

Remember: You're helping with appointment booking and information provider of Clinic, not general medical advice.`;

    // Call OpenAI API with timeout and tracing
    const openaiSubsegment = segment.addNewSubsegment('openai-api');
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        max_tokens: 1000,
        temperature: 0.7,
        presence_penalty: 0.1,
        frequency_penalty: 0.1
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('OpenAI API timeout')), 25000)
      )
    ]);
    openaiSubsegment.close();

    const aiReply = completion.choices[0].message.content;
    logger.debug('OpenAI response received', { 
      sessionId, 
      tokens: completion.usage?.total_tokens,
      model: completion.model 
    });

    // Check if user wants to confirm appointment and has all required information
    const wantsToConfirm = aiReply.toLowerCase().includes('confirm') || 
                          message.toLowerCase().includes('confirm') ||
                          message.toLowerCase().includes('book') ||
                          message.toLowerCase().includes('schedule');

    let finalReply = aiReply;
    let appointmentConfirmation = null;

    if (wantsToConfirm && hasAppointmentInfo) {
      // Validate appointment data
      const validation = validateAppointmentData(extractedAppointmentInfo);
      
      if (validation.valid) {
        // Create the appointment
        const appointment = await createAppointment(extractedAppointmentInfo);
        appointmentConfirmation = generateAppointmentConfirmation(appointment);
        finalReply = appointmentConfirmation.confirmationMessage;
        
        logger.info('Appointment confirmed:', appointment.id);
      } else {
        finalReply = `I need a bit more information to book your appointment. Please provide: ${validation.errors.join(', ')}`;
      }
    }

    // Save AI reply
    const aiMessage = await saveMessage(sessionId, 'assistant', finalReply);
    logger.debug('AI message saved', { sessionId, messageId: aiMessage._id });

    const responseTime = Date.now() - startTime;
    logger.info('Chat request completed successfully', { 
      sessionId, 
      responseTime,
      messageLength: message.length,
      replyLength: finalReply.length,
      appointmentBooked: !!appointmentConfirmation
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        reply: finalReply,
        sessionId,
        responseTime,
        tokens: completion.usage?.total_tokens,
        appointmentConfirmation,
        extractedAppointmentInfo
      })
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error('Chat handler error:', {
      error: error.message,
      stack: error.stack,
      responseTime,
      sessionId: event.body ? JSON.parse(event.body).sessionId : 'unknown'
    });
    
    let statusCode = 500;
    let errorMessage = 'Internal server error';
    
    if (error.message.includes('OpenAI API timeout')) {
      statusCode = 408;
      errorMessage = 'Request timeout - please try again';
    } else if (error.message.includes('rate limit')) {
      statusCode = 429;
      errorMessage = 'OpenAI rate limit exceeded - please try again later';
    } else if (error.message.includes('authentication')) {
      statusCode = 401;
      errorMessage = 'OpenAI authentication failed';
    } else if (error.message.includes('quota')) {
      statusCode = 429;
      errorMessage = 'OpenAI quota exceeded';
    } else if (error.message.includes('MongoDB')) {
      statusCode = 503;
      errorMessage = 'Database service temporarily unavailable';
    }

    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: errorMessage,
        sessionId: event.body ? JSON.parse(event.body).sessionId : 'unknown',
        responseTime
      })
    };
  }
}; 