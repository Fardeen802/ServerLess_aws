#!/usr/bin/env node

require('dotenv').config({ path: '.env.prod' });
const { insertClinicInformation } = require('../src/utils/pinecone');
const logger = require('../src/utils/logger');

async function main() {
  try {
    console.log('🚀 Starting clinic information insertion...');
    
    const count = await insertClinicInformation();
    
    console.log(`✅ Successfully inserted ${count} clinic information items into Pinecone`);
    console.log('🎉 Your appointment booking chatbot is now ready with clinic knowledge!');
    
  } catch (error) {
    console.error('❌ Error inserting clinic information:', error);
    process.exit(1);
  }
}

main(); 