/**
 * API Routes for the LieDetector backend
 */

import { Router, Request, Response } from 'express';
import { verifyClaims, getCacheStats, clearCache } from '../services/verificationService';
import { nlpService, ExtractedClaim } from '../services/nlpService';
import { VerifyRequest, Claim } from '../types';
import { v4 as uuidv4 } from 'uuid';

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
 * POST /api/extract
 * Extract claims from text using NLP (without verification)
 */
router.post('/extract', async (req: Request, res: Response) => {
  try {
    const { text, url, maxClaims } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'Request must include text to extract claims from' 
      });
    }
    
    // Limit text size
    if (text.length > 100000) {
      return res.status(400).json({ 
        error: 'Text too long', 
        message: 'Maximum 100,000 characters per request' 
      });
    }
    
    console.log(`[API] /extract - ${text.length} chars from ${url || 'unknown'}`);
    
    // Try NLP service first
    const nlpClaims = await nlpService.extractClaims(text, url, maxClaims || 20);
    
    if (nlpClaims) {
      // Convert NLP claims to standard format
      const claims: Claim[] = nlpClaims.map((c: ExtractedClaim) => ({
        id: uuidv4(),
        text: c.text,
        context: `${c.claim_type} claim (confidence: ${(c.confidence * 100).toFixed(0)}%)`,
        sourceUrl: url,
      }));
      
      return res.json({
        claims,
        meta: {
          total: claims.length,
          source: 'nlp',
          nlpDetails: nlpClaims.map((c: ExtractedClaim) => ({
            text: c.text,
            claimType: c.claim_type,
            confidence: c.confidence,
            entities: c.entities,
            keywords: c.evidence_keywords,
          })),
        }
      });
    }
    
    // Fallback: return empty array if NLP service unavailable
    console.log('[API] NLP service unavailable, returning empty claims');
    return res.json({
      claims: [],
      meta: {
        total: 0,
        source: 'fallback',
        error: 'NLP service unavailable',
      }
    });
  } catch (error) {
    console.error('[API] /extract error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to extract claims'
    });
  }
});

/**
 * POST /api/extract-and-verify
 * Extract claims from text using NLP and verify them
 */
router.post('/extract-and-verify', async (req: Request, res: Response) => {
  try {
    const { text, url, maxClaims } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'Request must include text to extract claims from' 
      });
    }
    
    // Limit text size
    if (text.length > 100000) {
      return res.status(400).json({ 
        error: 'Text too long', 
        message: 'Maximum 100,000 characters per request' 
      });
    }
    
    console.log(`[API] /extract-and-verify - ${text.length} chars from ${url || 'unknown'}`);
    
    // Extract claims using NLP
    const nlpClaims = await nlpService.extractClaims(text, url, maxClaims || 20);
    
    if (!nlpClaims || nlpClaims.length === 0) {
      return res.json({
        claims: [],
        verifications: [],
        meta: {
          total: 0,
          source: nlpClaims === null ? 'fallback' : 'nlp',
          error: nlpClaims === null ? 'NLP service unavailable' : undefined,
        }
      });
    }
    
    // Convert NLP claims to standard format
    const claims: Claim[] = nlpClaims.map((c: ExtractedClaim) => ({
      id: uuidv4(),
      text: c.text,
      context: `${c.claim_type} claim (confidence: ${(c.confidence * 100).toFixed(0)}%)`,
      sourceUrl: url,
    }));
    
    console.log(`[API] Extracted ${claims.length} claims, now verifying...`);
    
    // Verify claims
    const { verifications, cachedCount } = await verifyClaims(claims);
    
    return res.json({
      claims,
      verifications,
      meta: {
        total: claims.length,
        fromCache: cachedCount,
        source: 'nlp',
        nlpDetails: nlpClaims.map((c: ExtractedClaim) => ({
          text: c.text,
          claimType: c.claim_type,
          confidence: c.confidence,
          entities: c.entities,
          keywords: c.evidence_keywords,
          charStart: c.char_start,
          charEnd: c.char_end,
        })),
      }
    });
  } catch (error) {
    console.error('[API] /extract-and-verify error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to extract and verify claims'
    });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', async (_req: Request, res: Response) => {
  const cacheStats = getCacheStats();
  const nlpAvailable = await nlpService.checkHealth();
  
  return res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cache: cacheStats,
    services: {
      googleFactCheck: !!process.env.GOOGLE_FACT_CHECK_API_KEY && 
                       process.env.GOOGLE_FACT_CHECK_API_KEY !== 'your_google_api_key_here',
      llmVerification: !!process.env.OPENAI_API_KEY && 
                       process.env.OPENAI_API_KEY !== 'your_openai_api_key_here',
      nlpService: nlpAvailable,
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
