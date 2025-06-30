const { MongoClient } = require('mongodb');
const logger = require('./logger');

// Connection cache
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedClient.topology && cachedClient.topology.isConnected()) {
    logger.debug('Using cached database connection');
    return { client: cachedClient, db: cachedDb };
  }

  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    logger.info('Connecting to MongoDB...');
    
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });

    await client.connect();
    
    // Test the connection
    await client.db().admin().ping();
    
    cachedClient = client;
    cachedDb = client.db();
    
    logger.info('Successfully connected to MongoDB');
    
    // Set up TTL index for automatic cleanup (30 days)
    const chatsCollection = cachedDb.collection('chats');
    await chatsCollection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60 } // 30 days
    );
    
    logger.info('TTL index created for automatic cleanup');
    
    return { client, db: cachedDb };
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    throw error;
  }
}

async function getCollection(collectionName) {
  try {
    const { db } = await connectToDatabase();
    return db.collection(collectionName);
  } catch (error) {
    logger.error(`Error getting collection ${collectionName}:`, error);
    throw error;
  }
}

async function healthCheck() {
  try {
    const { client } = await connectToDatabase();
    
    // Test database connectivity
    await client.db().admin().ping();
    
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      message: 'Database connection is healthy'
    };
  } catch (error) {
    logger.error('Database health check failed:', error);
    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      message: 'Database connection failed',
      error: error.message
    };
  }
}

// Graceful shutdown handler
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, closing database connection...');
  if (cachedClient) {
    await cachedClient.close();
    logger.info('Database connection closed');
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, closing database connection...');
  if (cachedClient) {
    await cachedClient.close();
    logger.info('Database connection closed');
  }
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  logger.error('Uncaught Exception:', error);
  if (cachedClient) {
    await cachedClient.close();
  }
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (cachedClient) {
    await cachedClient.close();
  }
  process.exit(1);
});

module.exports = {
  connectToDatabase,
  getCollection,
  healthCheck
}; 