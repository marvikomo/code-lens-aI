import dotenv from 'dotenv';
dotenv.config();


export const Config = {
    neo4j: {
      uri: process.env.NEO4J_URI || 'neo4j://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || 'password'
    },
    targetDirectory: process.env.TARGET_DIR || './src',
    batchSize: 100,
    supportedExtensions: ['.js', '.ts', '.jsx', '.tsx'],
    superbaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY
  };