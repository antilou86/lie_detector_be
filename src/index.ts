/**
 * LieDetector Backend Server
 * 
 * Provides fact-checking API for the browser extension
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: '*', // Allow requests from the extension
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '1mb' }));

// Request logging
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api', apiRoutes);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    name: 'LieDetector Backend',
    version: '0.1.0',
    endpoints: {
      verify: 'POST /api/verify',
      health: 'GET /api/health',
      cacheStats: 'GET /api/cache/stats',
      cacheClear: 'POST /api/cache/clear',
    }
  });
});

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║         LieDetector Backend Server v0.1.0              ║
╠════════════════════════════════════════════════════════╣
║  Server running on: http://localhost:${PORT}              ║
║                                                        ║
║  Endpoints:                                            ║
║    POST /api/verify     - Verify claims                ║
║    GET  /api/health     - Health check                 ║
║    GET  /api/cache/stats - Cache statistics            ║
╚════════════════════════════════════════════════════════╝
  `);
  
  // Check for API keys
  const hasGoogleKey = process.env.GOOGLE_FACT_CHECK_API_KEY && 
                       process.env.GOOGLE_FACT_CHECK_API_KEY !== 'your_google_api_key_here';
  const hasOpenAIKey = process.env.OPENAI_API_KEY && 
                       process.env.OPENAI_API_KEY !== 'your_openai_api_key_here';
  
  if (hasGoogleKey) {
    console.log('✅ Google Fact Check API configured');
  } else {
    console.warn('⚠️  GOOGLE_FACT_CHECK_API_KEY not configured');
    console.warn('   Get your API key from: https://console.cloud.google.com/apis/credentials');
  }
  
  if (hasOpenAIKey) {
    console.log('✅ OpenAI API configured (LLM fallback enabled)');
  } else {
    console.warn('⚠️  OPENAI_API_KEY not configured');
    console.warn('   LLM-based verification fallback disabled');
    console.warn('   Get your API key from: https://platform.openai.com/api-keys');
  }
  
  if (!hasGoogleKey && !hasOpenAIKey) {
    console.warn('\n❌ No verification APIs configured - all claims will return as "unverified"');
  }
});
