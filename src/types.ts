/**
 * Type definitions for the LieDetector backend
 */

export type Rating = 
  | 'verified'
  | 'mostly_true'
  | 'mixed'
  | 'mostly_false'
  | 'false'
  | 'unverified'
  | 'opinion'
  | 'outdated';

export interface Claim {
  id: string;
  text: string;
  context?: string;
  sourceUrl?: string;
}

export interface Evidence {
  url: string;
  sourceName: string;
  quote?: string;
  datePublished?: string;
  peerReviewed?: boolean;
}

export interface Verification {
  claimId: string;
  rating: Rating;
  confidence: number;
  summary: string;
  evidence: Evidence[];
  checkedAt: string;
  caveats?: string[];
}

export interface VerifyRequest {
  claims: Claim[];
  url?: string;
}

export interface VerifyResponse {
  verifications: Verification[];
  cached: boolean;
}

// Google Fact Check API types
export interface GoogleFactCheckClaim {
  text: string;
  claimant?: string;
  claimDate?: string;
  claimReview: GoogleClaimReview[];
}

export interface GoogleClaimReview {
  publisher: {
    name: string;
    site: string;
  };
  url: string;
  title: string;
  reviewDate: string;
  textualRating: string;
  languageCode: string;
}

export interface GoogleFactCheckResponse {
  claims?: GoogleFactCheckClaim[];
  nextPageToken?: string;
}

// ClaimBuster API types
export interface ClaimBusterResult {
  text: string;
  score: number;
}
