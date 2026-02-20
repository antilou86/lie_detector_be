/**
 * Verification Service - Aggregates results from multiple fact-checking sources
 * 
 * Verification flow:
 * 1. Check cache
 * 2. Google Fact Check API (authoritative fact-checkers)
 * 3. PubMed for health claims (scientific literature)
 * 4. Wikipedia (reference information, supplementary)
 * 5. OpenAI LLM fallback
 * 6. Return unverified if nothing found
 */

import NodeCache from 'node-cache';
import { Claim, Verification, Rating, Evidence } from '../types';
import { searchFactChecks } from './googleFactCheck';
import { verifyClaimWithLLM } from './llmService';
import { verifyWithWikipedia } from './wikipediaService';
import { verifyWithPubMed, isHealthClaim } from './pubmedService';

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
 * Merge evidence from multiple sources, avoiding duplicates
 */
function mergeEvidence(primary: Evidence[], secondary: Evidence[]): Evidence[] {
  const seen = new Set(primary.map(e => e.url));
  const unique = secondary.filter(e => e.url && !seen.has(e.url));
  return [...primary, ...unique].slice(0, 10); // Limit to 10 pieces of evidence
}

/**
 * Combine verifications from multiple sources
 */
function combineVerifications(
  claim: Claim,
  results: Array<Verification | null>
): Verification {
  const validResults = results.filter((r): r is Verification => r !== null);
  
  if (validResults.length === 0) {
    return createUnverifiedResult(claim);
  }
  
  // Sort by confidence (highest first)
  validResults.sort((a, b) => b.confidence - a.confidence);
  
  // Use the highest confidence result as primary
  const primary = validResults[0];
  
  // Merge evidence from all sources
  let allEvidence = primary.evidence;
  for (const result of validResults.slice(1)) {
    allEvidence = mergeEvidence(allEvidence, result.evidence);
  }
  
  // Combine caveats
  const allCaveats = new Set<string>();
  for (const result of validResults) {
    if (result.caveats) {
      result.caveats.forEach(c => allCaveats.add(c));
    }
  }
  
  // Build combined summary
  let summary = primary.summary;
  if (validResults.length > 1) {
    summary += ` (Verified against ${validResults.length} sources)`;
  }
  
  return {
    claimId: claim.id,
    rating: primary.rating,
    confidence: primary.confidence,
    summary,
    evidence: allEvidence,
    checkedAt: new Date().toISOString(),
    caveats: Array.from(allCaveats).slice(0, 5),
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
    return { 
      verification: { ...cached, claimId: claim.id }, 
      cached: true 
    };
  }
  
  console.log(`[VerificationService] Verifying: "${claim.text.substring(0, 50)}..."`);
  
  const googleApiKey = process.env.GOOGLE_FACT_CHECK_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const pubmedApiKey = process.env.PUBMED_API_KEY; // Optional
  
  const results: Array<Verification | null> = [];
  
  // 1. Try Google Fact Check API first (most authoritative)
  if (googleApiKey && googleApiKey !== 'your_google_api_key_here') {
    const googleResult = await searchFactChecks(claim, googleApiKey);
    if (googleResult && googleResult.rating !== 'unverified') {
      // High confidence result from fact-checkers - use it
      console.log(`[VerificationService] Found definitive fact-check from Google`);
      results.push(googleResult);
    }
  }
  
  // 2. For health claims, check PubMed
  if (isHealthClaim(claim.text)) {
    try {
      const pubmedResult = await verifyWithPubMed(claim, pubmedApiKey);
      if (pubmedResult) {
        console.log(`[VerificationService] Found relevant PubMed research`);
        results.push(pubmedResult);
      }
    } catch (error) {
      console.error('[VerificationService] PubMed error:', error);
    }
  }
  
  // 3. Try Wikipedia for supplementary information
  try {
    const wikiResult = await verifyWithWikipedia(claim);
    if (wikiResult && wikiResult.evidence.length > 0) {
      console.log(`[VerificationService] Found Wikipedia reference`);
      // Only add if we have no other results or to supplement
      if (results.length === 0) {
        results.push(wikiResult);
      } else {
        // Add Wikipedia evidence to existing results
        results.push(wikiResult);
      }
    }
  } catch (error) {
    console.error('[VerificationService] Wikipedia error:', error);
  }
  
  // 4. If no results, try LLM as last resort
  if (results.length === 0 || results.every(r => r?.rating === 'unverified')) {
    if (openaiApiKey && openaiApiKey !== 'your_openai_api_key_here') {
      console.log(`[VerificationService] No fact-checks found, trying LLM verification...`);
      try {
        const llmResult = await verifyClaimWithLLM(claim, openaiApiKey);
        if (llmResult) {
          results.push(llmResult);
        }
      } catch (error) {
        console.error('[VerificationService] LLM error:', error);
      }
    }
  }
  
  // Combine all results
  const verification = combineVerifications(claim, results);
  
  // Cache the result
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
