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
const { getMessages, appendMessage } = require('../utils/inMemoryStore');

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
  const FUNCTIONS = [
    {
    type : "function",
    name: 'book_appointment',
    description: 'Book a new appointment for a patient',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        dob: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        providerName: { type: 'string',
          enum : ['Dr. M Subhan', 'Dr. M Owais', 'Dr. A Uddin', 'Dr. F Shaik','Dr. Omar Shaik']
        },
        reasonForVisit: { type: 'string' },
        windowStart: { type: 'string' },
        windowEnd: { type: 'string' }
      },
      required: ['name','dob','providerName', 'reasonForVisit','windowStart','windowEnd']
    }
  }
  ];
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
    if (relevantContext?.length > 0) {
      contextPrompt += '\n\nPrevious conversation context:\n';
      relevantContext.forEach(match => {
        contextPrompt += `- ${match.metadata.message}\n`;
      });
    }
    
    if (appointmentInfo?.length > 0) {
      contextPrompt += '\n\nRelevant appointment information:\n';
      appointmentInfo.forEach(match => {
        contextPrompt += `- ${JSON.stringify(match.metadata)}\n`;
      });
    }
    
    if (clinicInfo?.length > 0) {
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
    6. Call appropriate function if required
    
    Remember: You're helping with appointment booking and information provider of Clinic, not general medical advice.`;

    const userMessage = await getMessages(sessionId, systemPrompt);
    logger.debug('User message saved', { sessionId, messageId: userMessage._id });

    // Call OpenAI API with timeout and tracing
    const openaiSubsegment = segment.addNewSubsegment('openai-api');
    const first = await openai.responses.create({
      model: 'gpt-4o-mini',
      messages: userMessage,
      instructions : systemPrompt,
      temperature: 0.7,
      tools: FUNCTIONS,
      tool_choice: 'auto',
    });
    openaiSubsegment.close();
    const choice = first.output[0];
    console.log("choice type -> ", choice.type);

    if (choice.type === 'function_call') {
      const { name, arguments } = choice;
      const args = JSON.parse(choice?.arguments);
      console.log('inside function call args -> ', args);

      let functionResult;

      if (name === 'book_appointment') {
        let appointmentId = 'appt_' + crypto.randomUUID.toString();
        functionResult['appointmentId'] = appointmentId;
        functionResult['message'] =
          `your appointment is successfully created with reference number ${appointmentId}`;
      }
      console.log('function result -> ', JSON.stringify(functionResult));

      appendMessage(sessionId, choice);
      appendMessage(sessionId, {
        type: 'function_call_output',
        call_id: choice.call_id,
        output: JSON.stringify(functionResult),
      });
      const messagesInput = getMessages(sessionId).map(m => ({
        ...m,
      }));
      const second = await openai.responses.create({
        model: 'gpt-4o-mini',
        input: messagesInput,
        tools: FUNCTIONS,
        store: true,
      });
      console.log('second response -> ', second);
      const wrap = second.output_text;
      appendMessage(sessionId, { role: 'assistant', content: wrap });
    } else if (first.output_text) {
      appendMessage(sessionId, {
        role: 'assistant',
        content: first.output_text,
      });
    }
    const history = getMessages(sessionId);
    const last = history.filter(m=>m.role==='assistant').slice(-1)[0];
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        reply: last?.content,
        sessionId,
        tokens: choice?.usage?.total_tokens,
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