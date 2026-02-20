/**
 * API Routes for the LieDetector backend
 */

import { Router, Request, Response } from 'express';
import { verifyClaims, getCacheStats, clearCache } from '../services/verificationService';
import { VerifyRequest } from '../types';

const router = Router();

/**
 * POST /api/verify
 * Verify one or more claims
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { claims, url } = req.body as VerifyRequest;
    
    if (!claims || !Array.isArray(claims) || claims.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'Request must include a non-empty array of claims' 
      });
    }
    
    // Limit batch size to prevent abuse
    if (claims.length > 50) {
      return res.status(400).json({ 
        error: 'Too many claims', 
        message: 'Maximum 50 claims per request' 
      });
    }
    
    console.log(`[API] /verify - ${claims.length} claims from ${url || 'unknown'}`);
    
    const { verifications, cachedCount } = await verifyClaims(claims);
    
    return res.json({
      verifications,
      cached: cachedCount === claims.length,
      meta: {
        total: claims.length,
        fromCache: cachedCount,
      }
    });
  } catch (error) {
    console.error('[API] /verify error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to verify claims'
    });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  const cacheStats = getCacheStats();
  
  return res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cache: cacheStats,
    services: {
      googleFactCheck: !!process.env.GOOGLE_FACT_CHECK_API_KEY && 
                       process.env.GOOGLE_FACT_CHECK_API_KEY !== 'your_google_api_key_here',
      llmVerification: !!process.env.OPENAI_API_KEY && 
                       process.env.OPENAI_API_KEY !== 'your_openai_api_key_here',
    }
  });
});

/**
 * POST /api/cache/clear
 * Clear the verification cache (admin endpoint)
 */
router.post('/cache/clear', (_req: Request, res: Response) => {
  clearCache();
  return res.json({ 
    status: 'ok', 
    message: 'Cache cleared' 
  });
});

/**
 * GET /api/cache/stats
 * Get cache statistics
 */
router.get('/cache/stats', (_req: Request, res: Response) => {
  return res.json(getCacheStats());
});

export default router;
