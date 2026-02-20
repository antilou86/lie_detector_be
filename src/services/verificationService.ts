/**
 * Verification Service - Aggregates results from multiple fact-checking sources
 */

import NodeCache from 'node-cache';
import { Claim, Verification, Rating } from '../types';
import { searchFactChecks } from './googleFactCheck';
import { verifyClaimWithLLM } from './llmService';

// In-memory cache for verification results
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL || '3600'),
  checkperiod: 120,
});

/**
 * Generate a cache key for a claim
 */
function getCacheKey(claim: Claim): string {
  // Normalize the text for better cache hits
  const normalizedText = claim.text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
  
  return `claim:${normalizedText}`;
}

/**
 * Create a default unverified result
 */
function createUnverifiedResult(claim: Claim): Verification {
  return {
    claimId: claim.id,
    rating: 'unverified',
    confidence: 0.1,
    summary: 'No fact-checks found for this claim. This doesn\'t mean it\'s false or true - it simply hasn\'t been verified by known fact-checkers.',
    evidence: [],
    checkedAt: new Date().toISOString(),
    caveats: ['No existing fact-checks found', 'Consider verifying with primary sources'],
  };
}

/**
 * Verify a single claim using all available sources
 */
export async function verifyClaim(claim: Claim): Promise<{ verification: Verification; cached: boolean }> {
  const cacheKey = getCacheKey(claim);
  
  // Check cache first
  const cached = cache.get<Verification>(cacheKey);
  if (cached) {
    console.log(`[VerificationService] Cache hit for: "${claim.text.substring(0, 50)}..."`);
    // Update the claimId to match the current request
    return { 
      verification: { ...cached, claimId: claim.id }, 
      cached: true 
    };
  }
  
  console.log(`[VerificationService] Verifying: "${claim.text.substring(0, 50)}..."`);
  
  // Try Google Fact Check API first
  const googleApiKey = process.env.GOOGLE_FACT_CHECK_API_KEY;
  let verification: Verification | null = null;
  
  if (googleApiKey && googleApiKey !== 'your_google_api_key_here') {
    verification = await searchFactChecks(claim, googleApiKey);
  }
  
  // If no fact-checks found, try LLM-based verification as fallback
  if (!verification) {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey && openaiApiKey !== 'your_openai_api_key_here') {
      console.log(`[VerificationService] No fact-checks found, trying LLM verification...`);
      verification = await verifyClaimWithLLM(claim, openaiApiKey);
    }
  }
  
  // If still no results, return unverified
  if (!verification) {
    verification = createUnverifiedResult(claim);
  }
  
  // Cache the result (using normalized key so similar claims share cache)
  cache.set(cacheKey, verification);
  
  return { verification, cached: false };
}

/**
 * Delay helper for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verify multiple claims with rate limiting (sequential to avoid 503s)
 */
export async function verifyClaims(claims: Claim[]): Promise<{ verifications: Verification[]; cachedCount: number }> {
  console.log(`[VerificationService] Verifying ${claims.length} claims...`);
  
  const results: { verification: Verification; cached: boolean }[] = [];
  let cachedCount = 0;
  let verifiedCount = 0;
  
  for (const claim of claims) {
    const result = await verifyClaim(claim);
    results.push(result);
    
    if (result.cached) {
      cachedCount++;
    } else if (result.verification.rating !== 'unverified') {
      verifiedCount++;
    }
    
    // Rate limit: wait 500ms between API calls (only if not cached) to avoid Google 503s
    if (!result.cached && claims.indexOf(claim) < claims.length - 1) {
      await delay(500);
    }
  }
  
  const verifications = results.map(r => r.verification);
  
  console.log(`[VerificationService] Complete. ${cachedCount} cached, ${verifiedCount} verified, ${claims.length - cachedCount - verifiedCount} unverified`);
  
  return { verifications, cachedCount };
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { keys: number; hits: number; misses: number } {
  const stats = cache.getStats();
  return {
    keys: cache.keys().length,
    hits: stats.hits,
    misses: stats.misses,
  };
}

/**
 * Clear the cache
 */
export function clearCache(): void {
  cache.flushAll();
  console.log('[VerificationService] Cache cleared');
}
