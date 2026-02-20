/**
 * Google Fact Check Tools API integration
 * 
 * Documentation: https://developers.google.com/fact-check/tools/api
 */

import axios from 'axios';
import { 
  Claim, 
  Evidence, 
  Rating, 
  Verification,
  GoogleFactCheckResponse,
  GoogleClaimReview
} from '../types';

const GOOGLE_API_BASE = 'https://factchecktools.googleapis.com/v1alpha1';

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000; // 1 second
const MAX_BACKOFF_MS = 10000; // 10 seconds

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff with jitter
 */
function getBackoffDelay(attempt: number): number {
  const exponentialDelay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 500; // Add 0-500ms random jitter
  return Math.min(exponentialDelay + jitter, MAX_BACKOFF_MS);
}

/**
 * Map Google's textual ratings to our standardized ratings
 */
function mapRating(textualRating: string): Rating {
  const rating = textualRating.toLowerCase();
  
  // True/Verified
  if (rating.includes('true') && !rating.includes('false') && !rating.includes('mostly') && !rating.includes('partly')) {
    return 'verified';
  }
  
  // Mostly True
  if (rating.includes('mostly true') || rating.includes('mostly accurate') || rating.includes('largely true')) {
    return 'mostly_true';
  }
  
  // Mixed/Half True
  if (rating.includes('mixed') || rating.includes('half') || rating.includes('partly') || 
      rating.includes('partially') || rating.includes('misleading')) {
    return 'mixed';
  }
  
  // Mostly False
  if (rating.includes('mostly false') || rating.includes('largely false') || rating.includes('mostly inaccurate')) {
    return 'mostly_false';
  }
  
  // False
  if (rating.includes('false') || rating.includes('pants on fire') || rating.includes('incorrect') ||
      rating.includes('wrong') || rating.includes('fake') || rating.includes('hoax')) {
    return 'false';
  }
  
  // Opinion
  if (rating.includes('opinion') || rating.includes('satire') || rating.includes('commentary')) {
    return 'opinion';
  }
  
  // Outdated
  if (rating.includes('outdated') || rating.includes('old') || rating.includes('no longer')) {
    return 'outdated';
  }
  
  // Default to unverified if we can't map
  return 'unverified';
}

/**
 * Calculate confidence based on number and consistency of reviews
 */
function calculateConfidence(reviews: GoogleClaimReview[]): number {
  if (reviews.length === 0) return 0.3;
  if (reviews.length === 1) return 0.6;
  
  // Multiple reviews increase confidence
  const baseConfidence = Math.min(0.9, 0.5 + (reviews.length * 0.1));
  
  // Check consistency of ratings
  const ratings = reviews.map(r => mapRating(r.textualRating));
  const uniqueRatings = new Set(ratings);
  
  // More consistent ratings = higher confidence
  const consistencyBonus = uniqueRatings.size === 1 ? 0.1 : 0;
  
  return Math.min(0.95, baseConfidence + consistencyBonus);
}

/**
 * Search for fact-checks related to a claim with retry logic
 */
export async function searchFactChecks(
  claim: Claim,
  apiKey: string
): Promise<Verification | null> {
  if (!apiKey) {
    console.warn('[GoogleFactCheck] No API key configured');
    return null;
  }
  
  console.log(`[GoogleFactCheck] Searching for: "${claim.text.substring(0, 100)}..."`);
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get<GoogleFactCheckResponse>(
        `${GOOGLE_API_BASE}/claims:search`,
        {
          params: {
            key: apiKey,
            query: claim.text,
            languageCode: 'en',
          },
          timeout: 10000,
        }
      );
      
      const { claims } = response.data;
      
      if (!claims || claims.length === 0) {
        console.log(`[GoogleFactCheck] No fact-checks found for this claim`);
        return null;
      }
    
    console.log(`[GoogleFactCheck] Found ${claims.length} matching fact-checks!`);
    
    // Find the most relevant claim (first result is usually best match)
    const topClaim = claims[0];
    console.log(`[GoogleFactCheck] Top claim text: "${topClaim.text?.substring(0, 80)}..."`);
    
    const reviews = topClaim.claimReview || [];
    console.log(`[GoogleFactCheck] Reviews count: ${reviews.length}`);
    
    if (reviews.length === 0) {
      console.log(`[GoogleFactCheck] No reviews found for matched claim`);
      return null;
    }
    
    // Aggregate ratings from all reviews
    const ratings = reviews.map(r => mapRating(r.textualRating));
    
    // Use the most common rating, or the first if all different
    const ratingCounts = ratings.reduce((acc, r) => {
      acc[r] = (acc[r] || 0) + 1;
      return acc;
    }, {} as Record<Rating, number>);
    
    const aggregateRating = Object.entries(ratingCounts)
      .sort((a, b) => b[1] - a[1])[0][0] as Rating;
    
    // Build evidence from reviews
    const evidence: Evidence[] = reviews.map(review => ({
      url: review.url,
      sourceName: review.publisher.name,
      quote: review.title,
      datePublished: review.reviewDate,
      peerReviewed: false, // Fact-checkers aren't peer-reviewed in academic sense
    }));
    
    // Generate summary
    const primaryReview = reviews[0];
    const summary = `${primaryReview.publisher.name} rated this claim as "${primaryReview.textualRating}". ` +
      (reviews.length > 1 ? `${reviews.length} fact-checkers have reviewed this claim.` : '');
    
    const result = {
      claimId: claim.id,
      rating: aggregateRating,
      confidence: calculateConfidence(reviews),
      summary,
      evidence,
      checkedAt: new Date().toISOString(),
    };
    
    console.log(`[GoogleFactCheck] SUCCESS! Returning verification: rating=${aggregateRating}, confidence=${result.confidence}`);
    return result;
    } catch (error) {
      lastError = error as Error;
      
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        
        // Only retry on 503 (service unavailable) or 429 (rate limit)
        if (status === 503 || status === 429) {
          const delay = getBackoffDelay(attempt);
          console.warn(`[GoogleFactCheck] API error ${status}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await sleep(delay);
          continue;
        }
        
        // Don't retry on other errors (400, 401, 403, etc.)
        console.error('[GoogleFactCheck] API error:', status, error.response?.data);
        return null;
      }
      
      console.error('[GoogleFactCheck] Error:', error);
      return null;
    }
  }
  
  // All retries exhausted
  console.error(`[GoogleFactCheck] All ${MAX_RETRIES} retries exhausted`, lastError);
  return null;
}
