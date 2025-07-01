const { MongoClient } = require('mongodb');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

const mongoUri = process.env.MONGODB_URI;
const pineconeApiKey = process.env.PINECONE_API_KEY;
const pineconeEnv = process.env.PINECONE_ENVIRONMENT;
const pineconeIndexName = process.env.PINECONE_INDEX_NAME || 'chatbot-as';
const openaiApiKey = process.env.OPENAI_API_KEY;

let pineconeClient;
let pineconeIndex;
let mongoClient;
let awsCollection;
let openai;

async function initOpenAI() {
  if (!openai) {
  openai = new OpenAI({ 
      apiKey: openaiApiKey,
    });
  }
}

async function initPinecone() {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: pineconeApiKey,
    });
    
    const indexes = await pineconeClient.listIndexes();
    if (!indexes.includes(pineconeIndexName)) {
      await pineconeClient.createIndex({
        name: pineconeIndexName,
        dimension: 1536,
        metric: 'cosine'
      });
      
      // Wait for index to be ready
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      // Insert comprehensive appointment bot information
      const appointmentBotInfo = [
        {
          id: 'bot-intro',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'I am an appointment booking assistant. I help users schedule appointments with specific doctors and services in a friendly, conversational manner.',
            category: 'introduction'
          }
        },
        {
          id: 'services-available',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'Available services include: general consultation, dental checkup, dermatology, cardiology, pediatrics, physiotherapy, eye care, and vaccination.',
            category: 'services'
          }
        },
        {
          id: 'doctors-list',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'Our doctors: Dr. Alice Smith (General Physician), Dr. Bob Johnson (Dentist), Dr. Carol Lee (Dermatologist), Dr. David Kim (Cardiologist), Dr. Eva Brown (Pediatrician), Dr. Frank White (Physiotherapist), Dr. Grace Green (Ophthalmologist).',
            category: 'doctors'
          }
        },
        {
          id: 'booking-process',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'To book an appointment, I need: your full name, email address, phone number, desired doctor, service, preferred date, and preferred time. I will guide you through each step.',
            category: 'process'
          }
        },
        {
          id: 'name-collection',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'Please provide your full name as it appears on your identification documents.',
            category: 'name'
          }
        },
        {
          id: 'email-collection',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'Please provide a valid email address where we can send appointment confirmations and updates.',
            category: 'email'
          }
        },
        {
          id: 'phone-collection',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'Please provide your phone number including country code if applicable.',
            category: 'phone'
          }
        },
        {
          id: 'doctor-selection',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'Which doctor would you like to book an appointment with? You can choose from Dr. Alice Smith, Dr. Bob Johnson, Dr. Carol Lee, Dr. David Kim, Dr. Eva Brown, Dr. Frank White, or Dr. Grace Green.',
            category: 'doctor'
          }
        },
        {
          id: 'service-selection',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'What type of service would you like to book? You can choose from general consultation, dental checkup, dermatology, cardiology, pediatrics, physiotherapy, eye care, or vaccination.',
            category: 'service'
          }
        },
        {
          id: 'date-selection',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'What date would you prefer for your appointment? Please provide the date in MM/DD/YYYY format.',
            category: 'date'
          }
        },
        {
          id: 'time-selection',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'What time would you prefer for your appointment? We are available from 9:00 AM to 6:00 PM.',
            category: 'time'
          }
        },
        {
          id: 'confirmation',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'Thank you for providing all the information. Your appointment has been successfully booked and you will receive a confirmation email shortly.',
            category: 'confirmation'
          }
        },
        {
          id: 'greeting',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'Hello! Welcome to our appointment booking service. I\'m here to help you schedule an appointment with our doctors. How can I assist you today?',
            category: 'greeting'
          }
        },
        {
          id: 'help',
          values: Array(1536).fill(0.01),
          metadata: {
            text: 'I can help you book appointments, check availability, reschedule existing appointments, or answer questions about our doctors and services.',
            category: 'help'
          }
        }
      ];
      
      await pineconeClient.index(pineconeIndexName, { environment: pineconeEnv }).upsert({
        upsertRequest: { vectors: appointmentBotInfo }
      });
    }
    pineconeIndex = pineconeClient.index(pineconeIndexName, { environment: pineconeEnv });
  }
}

async function initMongo() {
  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    const db = mongoClient.db();
    awsCollection = db.collection('AWS');
  }
}

const appointmentFields = [
  { key: 'name', prompt: 'What is your full name?' },
  { key: 'email', prompt: 'What is your email address?' },
  { key: 'phoneNumber', prompt: 'What is your phone number?' },
  { key: 'doctor', prompt: 'Which doctor would you like to book an appointment with? (Dr. Alice Smith, Dr. Bob Johnson, Dr. Carol Lee, Dr. David Kim, Dr. Eva Brown, Dr. Frank White, Dr. Grace Green)' },
  { key: 'service', prompt: 'What service would you like to book? (general consultation, dental checkup, dermatology, cardiology, pediatrics, physiotherapy, eye care, vaccination)' },
  { key: 'date', prompt: 'What date would you like the appointment? (MM/DD/YYYY)' },
  { key: 'time', prompt: 'What time would you like the appointment?' },
];

const sessions = {};

async function getAIResponse(userMessage, session, step) {
  const systemPrompt = `You are a friendly appointment booking assistant. You help users schedule appointments by collecting their information in a natural, conversational way.

Current conversation context:
- Step: ${step + 1} of ${appointmentFields.length}
- Current field: ${appointmentFields[step]?.key || 'complete'}
- Collected data: ${JSON.stringify(session.data)}

Available services: general consultation, dental checkup, dermatology, cardiology, pediatrics, physiotherapy, eye care, vaccination.

Instructions:
1. Be friendly and conversational
2. If this is the first message, greet the user and ask for their name
3. If collecting information, ask for the current field in a natural way
4. If all information is collected, confirm the appointment and thank them
5. Keep responses concise but warm
6. Don't ask for information already collected

User message: "${userMessage}"`;

  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ],
    max_tokens: 150,
    temperature: 0.7
  });

  return completion.choices[0].message.content;
}

module.exports.handler = async (event) => {
  try {
    await Promise.all([initOpenAI(), initPinecone(), initMongo()]);
    
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { sessionId, message } = body;
    
    if (!sessionId || !message) {
      return {
        statusCode: 400,
        headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: JSON.stringify({ error: 'sessionId and message are required.' })
      };
    }

    if (!sessions[sessionId]) {
      sessions[sessionId] = { step: 0, data: {} };
    }
    const session = sessions[sessionId];

    // Save user input for the previous field
    if (session.step > 0 && session.step <= appointmentFields.length) {
      const prevField = appointmentFields[session.step - 1].key;
      session.data[prevField] = message;
    }

    // Check if all fields are collected
    if (session.step >= appointmentFields.length) {
      // Store completed appointment in MongoDB
      const appointmentData = {
        ...session.data,
        createdAt: new Date(),
        sessionId: sessionId
      };
      
      await awsCollection.insertOne(appointmentData);
      delete sessions[sessionId];
      
      const aiResponse = await getAIResponse(message, session, appointmentFields.length);
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: JSON.stringify({ 
          response: aiResponse,
          appointment: appointmentData,
          completed: true
        })
      };
    }

    // Get AI response for next step
    const aiResponse = await getAIResponse(message, session, session.step);
    session.step++;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({ 
        response: aiResponse,
        step: session.step,
        totalSteps: appointmentFields.length
      })
    };

  } catch (error) {
    console.error('Error in chat handler:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      })
    };
  }
}; 