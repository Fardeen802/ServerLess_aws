const { healthCheck } = require('../utils/database');
const { healthCheck: pineconeHealthCheck } = require('../utils/pinecone');
const logger = require('../utils/logger');

module.exports.handler = async (event) => {
  const startTime = Date.now();
  
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    // Validate HTTP method
    if (event.httpMethod !== 'GET') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    // Debug: Check what environment variables are available
    const debugInfo = {
      mongodb_uri_exists: Boolean(process.env.MONGODB_URI),
      mongodb_uri_length: process.env.MONGODB_URI ? process.env.MONGODB_URI.length : 0,
      mongodb_uri_start: process.env.MONGODB_URI ? `${process.env.MONGODB_URI.substring(0, 20)}...` : 'undefined',
      openai_api_key_exists: Boolean(process.env.OPENAI_API_KEY),
      openai_api_key_length: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0,
      node_env: process.env.NODE_ENV,
      stage: process.env.STAGE,
      all_env_keys: Object.keys(process.env).filter(key => key.includes('MONGODB') || key.includes('OPENAI') || key.includes('NODE') || key.includes('STAGE'))
    };

    // Check database health
    let dbHealth;
    try {
      dbHealth = await healthCheck();
    } catch (dbError) {
      dbHealth = {
        status: 'unhealthy',
        error: dbError.message,
        timestamp: new Date().toISOString()
      };
    }
    
    // Check Pinecone health
    let pineconeHealth;
    try {
      pineconeHealth = await pineconeHealthCheck();
    } catch (pineconeError) {
      pineconeHealth = {
        status: 'unhealthy',
        error: pineconeError.message,
        timestamp: new Date().toISOString()
      };
    }
    
    // Check environment variables
    const envHealth = {
      mongodb_uri: Boolean(process.env.MONGODB_URI),
      openai_api_key: Boolean(process.env.OPENAI_API_KEY),
      pinecone_api_key: Boolean(process.env.PINECONE_API_KEY),
      pinecone_environment: Boolean(process.env.PINECONE_ENVIRONMENT),
      node_env: process.env.NODE_ENV || 'development',
      stage: process.env.STAGE || 'dev'
    };

    // Overall health status
    const isHealthy = dbHealth.status === 'healthy' && 
                     pineconeHealth.status === 'healthy' &&
                     envHealth.mongodb_uri && 
                     envHealth.openai_api_key &&
                     envHealth.pinecone_api_key &&
                     envHealth.pinecone_environment;

    const responseTime = Date.now() - startTime;
    
    const healthResponse = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseTime: `${responseTime}ms`,
      version: process.env.npm_package_version || '1.0.0',
      environment: {
        node_env: envHealth.node_env,
        stage: envHealth.stage
      },
      services: {
        database: dbHealth,
        pinecone: pineconeHealth,
        environment: envHealth
      },
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024)
      },
      debug: debugInfo
    };

    logger.info('Health check completed', { 
      status: healthResponse.status, 
      responseTime,
      memory: healthResponse.memory 
    });

    return {
      statusCode: 200, // Always return 200 for debugging
      headers,
      body: JSON.stringify(healthResponse)
    };

  } catch (error) {
    logger.error('Health check error:', error);
    
    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
        message: error.message,
        debug: {
          mongodb_uri_exists: Boolean(process.env.MONGODB_URI),
          openai_api_key_exists: Boolean(process.env.OPENAI_API_KEY),
          node_env: process.env.NODE_ENV,
          stage: process.env.STAGE
        }
      })
    };
  }
}; 