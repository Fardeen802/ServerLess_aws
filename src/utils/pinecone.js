const { Pinecone } = require('@pinecone-database/pinecone');
const logger = require('./logger');

// Initialize Pinecone client
let pinecone = null;
let index = null;

async function initializePinecone() {
  try {
    const apiKey = process.env.PINECONE_API_KEY;
    const environment = process.env.PINECONE_ENVIRONMENT;
    const indexName = process.env.PINECONE_INDEX_NAME || 'appointment-chatbot';

    if (!apiKey || !environment) {
      throw new Error('Pinecone API key and environment are required');
    }

    pinecone = new Pinecone({
      apiKey: apiKey
    });

    // Get or create index
    const { indexes } = await pinecone.listIndexes();
    logger.info('Available indexes:', indexes);
    logger.info('Desired index name:', indexName);
    const indexNames = Object.values(indexes).map(idx => idx.name);
    const indexExists = indexNames.includes(indexName);

    if (!indexExists) {
      logger.info('Creating Pinecone index:', indexName);
      await pinecone.createIndex({
        name: indexName,
        dimension: 3072, // OpenAI text-embedding-3-large dimension
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1'
          }
        }
      });
      
      // Wait for index to be ready
      await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute
    } else {
      logger.info('Pinecone index already exists:', indexName);
    }

    index = pinecone.index(indexName);
    logger.info('Pinecone initialized successfully');
    
    return index;
  } catch (error) {
    logger.error('Pinecone initialization error:', error);
    throw error;
  }
}

async function getPineconeIndex() {
  if (!index) {
    await initializePinecone();
  }
  return index;
}

// Add a function to get Pinecone index by name
async function getPineconeIndexByName(indexName) {
  if (!pinecone) {
    await initializePinecone();
  }
  return pinecone.index(indexName);
}

// Store conversation embedding
async function storeConversationEmbedding(sessionId, message, embedding, metadata = {}) {
  try {
    const pineconeIndex = await getPineconeIndex();
    
    const vector = {
      id: `${sessionId}-${Date.now()}`,
      values: embedding,
      metadata: {
        sessionId,
        message,
        timestamp: new Date().toISOString(),
        type: 'conversation',
        ...metadata
      }
    };

    await pineconeIndex.upsert([vector]);
    logger.debug('Stored conversation embedding for session:', sessionId);
    
    return vector.id;
  } catch (error) {
    logger.error('Error storing conversation embedding:', error);
    throw error;
  }
}

// Store appointment information embedding
async function storeAppointmentInfo(appointmentData, embedding) {
  try {
    const pineconeIndex = await getPineconeIndex();
    
    const vector = {
      id: `appointment-${Date.now()}`,
      values: embedding,
      metadata: {
        type: 'appointment_info',
        ...appointmentData,
        timestamp: new Date().toISOString()
      }
    };

    await pineconeIndex.upsert([vector]);
    logger.debug('Stored appointment info embedding');
    
    return vector.id;
  } catch (error) {
    logger.error('Error storing appointment info embedding:', error);
    throw error;
  }
}

// Search for relevant context
async function searchRelevantContext(query, sessionId, topK = 5) {
  try {
    const pineconeIndex = await getPineconeIndex();
    
    const queryResponse = await pineconeIndex.query({
      vector: query,
      topK: topK,
      filter: {
        sessionId: { $eq: sessionId }
      },
      includeMetadata: true
    });

    logger.debug('Found relevant context:', queryResponse.matches.length);
    return queryResponse.matches;
  } catch (error) {
    logger.error('Error searching for relevant context:', error);
    throw error;
  }
}

// Search for appointment information
async function searchAppointmentInfo(query, topK = 3, indexName = process.env.PINECONE_INDEX_NAME || 'appointment-chatbot') {
  try {
    const pineconeIndex = await getPineconeIndexByName(indexName);
    const queryResponse = await pineconeIndex.query({
      vector: query,
      topK: topK,
      filter: {
        type: { $eq: 'appointment_info' }
      },
      includeMetadata: true
    });
    logger.debug('Found appointment info:', queryResponse.matches.length);
    return queryResponse.matches;
  } catch (error) {
    logger.error('Error searching appointment info:', error);
    throw error;
  }
}

// Get conversation history from vectors
async function getConversationHistory(sessionId, limit = 10) {
  try {
    const pineconeIndex = await getPineconeIndex();
    
    const queryResponse = await pineconeIndex.query({
      vector: new Array(3072).fill(0), // Dummy vector for metadata-only query
      topK: limit,
      filter: {
        sessionId: { $eq: sessionId },
        type: { $eq: 'conversation' }
      },
      includeMetadata: true
    });

    // Sort by timestamp
    const sortedMatches = queryResponse.matches.sort((a, b) => 
      new Date(a.metadata.timestamp) - new Date(b.metadata.timestamp)
    );

    return sortedMatches.map(match => ({
      message: match.metadata.message,
      timestamp: match.metadata.timestamp,
      type: match.metadata.type
    }));
  } catch (error) {
    logger.error('Error getting conversation history:', error);
    throw error;
  }
}

// Health check for Pinecone
async function healthCheck() {
  try {
    const pineconeIndex = await getPineconeIndex();
    await pineconeIndex.describeIndexStats();
    
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      message: 'Pinecone connection is healthy'
    };
  } catch (error) {
    logger.error('Pinecone health check failed:', error);
    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      message: 'Pinecone connection failed',
      error: error.message
    };
  }
}

// Insert clinic information into Pinecone
async function insertClinicInformation() {
  try {
    const pineconeIndex = await getPineconeIndex();
    
    const clinicData = [
      {
        "id": "1",
        "text": "Our clinic is open Monday to Saturday from 9:00 AM to 7:00 PM. We are closed on Sundays.",
        "metadata": {
          "intent": "hours",
          "category": "clinic-info"
        }
      },
      {
        "id": "2",
        "text": "To book an appointment, please provide your full name, preferred date, time slot, and the department you want to visit.",
        "metadata": {
          "intent": "book_appointment",
          "category": "instructions"
        }
      },
      {
        "id": "3",
        "text": "Dr. Smith is a general physician available from 10 AM to 2 PM, Monday to Friday.",
        "metadata": {
          "intent": "doctor_availability",
          "department": "General Medicine",
          "doctor": "Dr. Smith"
        }
      },
      {
        "id": "4",
        "text": "Dr. Priya Sharma is our dermatologist, and is available on Tuesday, Thursday, and Saturday from 11 AM to 4 PM.",
        "metadata": {
          "intent": "doctor_availability",
          "department": "Dermatology",
          "doctor": "Dr. Priya Sharma"
        }
      },
      {
        "id": "5",
        "text": "You can cancel your appointment up to 4 hours before your scheduled time by messaging us or calling our front desk.",
        "metadata": {
          "intent": "cancel_policy",
          "category": "policies"
        }
      },
      {
        "id": "6",
        "text": "We offer appointments for General Medicine, Dermatology, Pediatrics, Cardiology, and Dental care.",
        "metadata": {
          "intent": "departments",
          "category": "clinic-info"
        }
      },
      {
        "id": "7",
        "text": "The clinic is located at 123 Health Street, New York, NY 10001. Parking is available for all patients.",
        "metadata": {
          "intent": "location",
          "category": "clinic-info"
        }
      },
      {
        "id": "8",
        "text": "Walk-in patients are accepted but we recommend booking an appointment to avoid waiting time.",
        "metadata": {
          "intent": "walkin_policy",
          "category": "clinic-info"
        }
      },
      {
        "id": "9",
        "text": "For emergencies, call 911 or go to the nearest hospital. Our clinic does not handle emergency cases.",
        "metadata": {
          "intent": "emergency_policy",
          "category": "policies"
        }
      },
      {
        "id": "10",
        "text": "You will receive a confirmation message once your appointment is booked.",
        "metadata": {
          "intent": "confirmation",
          "category": "process"
        }
      }
    ];

    // Initialize OpenAI for embeddings
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ 
      apiKey: process.env.OPENAI_API_KEY 
    });

    const vectors = [];

    for (const item of clinicData) {
      try {
        // Generate embedding for the text
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-large',
          input: item.text
        });
        
        const embedding = embeddingResponse.data[0].embedding;
        
        // Create vector object
        const vector = {
          id: `clinic-info-${item.id}`,
          values: embedding,
          metadata: {
            type: 'clinic_information',
            text: item.text,
            ...item.metadata,
            timestamp: new Date().toISOString()
          }
        };
        
        vectors.push(vector);
        logger.debug(`Generated embedding for clinic info ${item.id}`);
        
        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        logger.error(`Error generating embedding for clinic info ${item.id}:`, error);
      }
    }

    // Insert all vectors into Pinecone
    if (vectors.length > 0) {
      await pineconeIndex.upsert(vectors);
      logger.info(`Successfully inserted ${vectors.length} clinic information vectors into Pinecone`);
    }

    return vectors.length;
  } catch (error) {
    logger.error('Error inserting clinic information:', error);
    throw error;
  }
}

// Search for clinic information
async function searchClinicInfo(query, topK = 3, indexName = process.env.PINECONE_INDEX_NAME || 'appointment-chatbot') {
  try {
    const pineconeIndex = await getPineconeIndexByName(indexName);
    const queryResponse = await pineconeIndex.query({
      vector: query,
      topK: topK,
      filter: {
        type: { $eq: 'clinic_information' }
      },
      includeMetadata: true
    });
    logger.debug('Found clinic info:', queryResponse.matches.length);
    return queryResponse.matches;
  } catch (error) {
    logger.error('Error searching clinic info:', error);
    throw error;
  }
}

module.exports = {
  initializePinecone,
  getPineconeIndex,
  getPineconeIndexByName,
  storeConversationEmbedding,
  storeAppointmentInfo,
  searchRelevantContext,
  searchAppointmentInfo,
  getConversationHistory,
  insertClinicInformation,
  searchClinicInfo,
  healthCheck
}; 