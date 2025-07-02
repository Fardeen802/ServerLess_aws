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
let openai;

const sessions = {};

// MongoDB connection caching for Lambda cold/warm start
let cachedDb = null;
let cachedCollection = null;

const requiredFields = [
  "patientName",
  "dob",
  "email",
  "phone",
  "doctor",
  "service",
  "time",
  "status",
  "action",
  "chiefComplaint"
];

async function initOpenAI() {
  if (!openai) {
    openai = new OpenAI({ apiKey: openaiApiKey });
  }
}

async function initPinecone() {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({ apiKey: pineconeApiKey });
    const indexes = await pineconeClient.listIndexes();
    if (!indexes.includes(pineconeIndexName)) {
      console.warn(`Pinecone index ${pineconeIndexName} not found. Please run the setup script.`);
    }
    pineconeIndex = pineconeClient.index(pineconeIndexName, { environment: pineconeEnv });
  }
}

async function initMongo() {
  if (cachedDb && cachedCollection) {
    return { db: cachedDb, collection: cachedCollection };
  }
  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    cachedDb = mongoClient.db();
    cachedCollection = cachedDb.collection('actiontables');
    return { db: cachedDb, collection: cachedCollection };
  }
}

async function handleAIConversation(session, userMessage) {
  await initOpenAI();

  const prompt = `You're a helpful medical appointment assistant. Extract as many of the following fields as possible from the user message: ${requiredFields.join(", ")}.
Respond in two parts:
1. JSON with extracted fields
2. A message to continue the conversation and collect remaining info.

Fields collected so far:
${JSON.stringify(session.data, null, 2)}

User message:
"${userMessage}"

Respond like:
{
  "data": { ... },
  "nextPrompt": "What time would you like your appointment?"
}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'system', content: prompt }],
    temperature: 0.5,
    max_tokens: 300
  });

  try {
    const parsed = JSON.parse(completion.choices[0].message.content);
    return parsed;
  } catch (e) {
    return {
      data: {},
      nextPrompt: "Sorry, I didn't understand that. Can you rephrase?"
    };
  }
}

async function getConfirmationMessage(sessionData) {
  const prompt = `You're an appointment assistant. Confirm the following appointment details in a friendly tone:
${JSON.stringify(sessionData, null, 2)}
Ask if everything looks good.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'system', content: prompt }],
    temperature: 0.7,
    max_tokens: 150
  });

  return completion.choices[0].message.content;
}

// Optional session cleanup (15 mins timeout)
setInterval(() => {
  const now = Date.now();
  for (const id in sessions) {
    if (now - sessions[id].lastActive > 15 * 60 * 1000) {
      delete sessions[id];
    }
  }
}, 60 * 1000);

module.exports.handler = async (event) => {
  try {
    const { db, collection } = await initMongo();
    await initOpenAI();
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { sessionId, message } = body;
    if (!sessionId || !message) {
      return { statusCode: 400, headers: defaultHeaders(), body: JSON.stringify({ error: 'sessionId and message are required.' }) };
    }
    if (!sessions[sessionId]) {
      sessions[sessionId] = { step: 0, data: {}, lastActive: Date.now(), started: false };
    }
    const session = sessions[sessionId];
    session.lastActive = Date.now();

    // Check if appointment is complete
    const missingFields = requiredFields.filter(f => !session.data[f]);
    if (missingFields.length === 0) {
      if (/yes/i.test(message)) {
        const doc = { ...session.data, status: 'booked', action: 'appointment', createdAt: new Date(), sessionId };
        await collection.insertOne(doc);
        delete sessions[sessionId];
        return { statusCode: 200, headers: defaultHeaders(), body: JSON.stringify({ response: 'Your appointment is confirmed! Thank you.', appointment: doc, completed: true }) };
      } else if (/no/i.test(message)) {
        delete sessions[sessionId];
        return { statusCode: 200, headers: defaultHeaders(), body: JSON.stringify({ response: 'Appointment cancelled. If you want to start over, just say hi!', completed: false }) };
      } else {
        return { statusCode: 200, headers: defaultHeaders(), body: JSON.stringify({ response: PROMPTS.confirm(session), step: session.step, totalSteps: STEPS.length }) };
      }
    }

    // Run GPT conversation handler
    const { data, nextPrompt } = await handleAIConversation(session, message);
    session.data = { ...session.data, ...data };

    const stillMissing = requiredFields.filter(f => !session.data[f]);

    return {
      statusCode: 200,
      headers: defaultHeaders(),
      body: JSON.stringify({ response: nextPrompt, step: requiredFields.length - stillMissing.length, totalSteps: requiredFields.length })
    };

  } catch (err) {
    console.error('Error:', err);
    return { statusCode: 500, headers: defaultHeaders(), body: JSON.stringify({ error: 'Database connection error', message: err.message }) };
  }
};

function defaultHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}