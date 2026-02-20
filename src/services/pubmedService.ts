/**
 * PubMed/NCBI E-utilities Verification Service
 * 
 * Uses NCBI E-utilities to search PubMed for medical/scientific research
 * supporting or contradicting health-related claims.
 * 
 * Free to use, API key optional but recommended for higher rate limits.
 * Documentation: https://www.ncbi.nlm.nih.gov/books/NBK25500/
 */

import axios from 'axios';
import { Claim, Verification, Evidence } from '../types';

const PUBMED_SEARCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
const PUBMED_FETCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';
const PUBMED_SUMMARY_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';

interface PubMedArticle {
  uid: string;
  title: string;
  authors: string[];
  source: string; // Journal name
  pubdate: string;
  epubdate?: string;
  pmcid?: string;
}

/**
 * Detect if a claim is health/medical related
 */
export function isHealthClaim(claimText: string): boolean {
  const healthKeywords = [
    // Medical conditions
    'cancer', 'diabetes', 'heart disease', 'stroke', 'alzheimer', 'dementia',
    'depression', 'anxiety', 'obesity', 'hypertension', 'arthritis', 'asthma',
    'covid', 'coronavirus', 'flu', 'influenza', 'vaccine', 'vaccination',
    
    // Treatments
    'treatment', 'therapy', 'medication', 'drug', 'medicine', 'cure',
    'antibiotic', 'supplement', 'vitamin', 'remedy', 'surgery',
    
    // Health behaviors
    'diet', 'exercise', 'sleep', 'smoking', 'alcohol', 'caffeine',
    'nutrition', 'calorie', 'protein', 'carbohydrate', 'fat',
    
    // Body parts/systems
    'brain', 'heart', 'liver', 'kidney', 'lung', 'immune system',
    'blood pressure', 'cholesterol', 'blood sugar', 'metabolism',
    
    // Research terms
    'study', 'research', 'clinical trial', 'patients', 'symptoms',
    'risk', 'cause', 'prevent', 'reduce', 'increase', 'improve',
    
    // Medical professionals
    'doctor', 'physician', 'scientist', 'researcher', 'medical',
  ];
  
  const lowerText = claimText.toLowerCase();
  return healthKeywords.some(keyword => lowerText.includes(keyword));
}

/**
 * Extract medical search terms from claim
 */
function extractMedicalTerms(claimText: string): string {
  // Remove common claim phrases
  const cleaned = claimText
    .replace(/according to|studies show|research indicates|experts say|scientists found/gi, '')
    .replace(/can help|may help|could help|might help|is linked to|is associated with/gi, '')
    .replace(/approximately|about|around|percent|%/gi, '')
    .trim();
  
  // PubMed works better with shorter, focused queries
  const words = cleaned.split(/\s+/);
  if (words.length > 8) {
    return words.slice(0, 8).join(' ');
  }
  
  return cleaned;
}

/**
 * Search PubMed for relevant articles
 */
async function searchPubMed(query: string, apiKey?: string): Promise<string[]> {
  try {
    const params: Record<string, string> = {
      db: 'pubmed',
      term: query,
      retmode: 'json',
      retmax: '10',
      sort: 'relevance',
    };
    
    if (apiKey) {
      params.api_key = apiKey;
    }
    
    const response = await axios.get(PUBMED_SEARCH_URL, {
      params,
      timeout: 15000,
    });
    
    const idList = response.data?.esearchresult?.idlist;
    return idList || [];
  } catch (error) {
    console.error('[PubMedService] Search error:', error);
    return [];
  }
}

/**
 * Get article summaries from PubMed IDs
 */
async function getArticleSummaries(ids: string[], apiKey?: string): Promise<PubMedArticle[]> {
  if (ids.length === 0) return [];
  
  try {
    const params: Record<string, string> = {
      db: 'pubmed',
      id: ids.join(','),
      retmode: 'json',
    };
    
    if (apiKey) {
      params.api_key = apiKey;
    }
    
    const response = await axios.get(PUBMED_SUMMARY_URL, {
      params,
      timeout: 15000,
    });
    
    const result = response.data?.result;
    if (!result) return [];
    
    return ids.map(id => {
      const article = result[id];
      if (!article) return null;
      
      return {
        uid: id,
        title: article.title || 'Untitled',
        authors: article.authors?.map((a: any) => a.name) || [],
        source: article.source || article.fulljournalname || 'Unknown Journal',
        pubdate: article.pubdate || article.epubdate || '',
        epubdate: article.epubdate,
        pmcid: article.pmcid,
      };
    }).filter(Boolean) as PubMedArticle[];
  } catch (error) {
    console.error('[PubMedService] Summary fetch error:', error);
    return [];
  }
}

/**
 * Analyze if article titles support the claim
 */
function analyzeArticleRelevance(claimText: string, articles: PubMedArticle[]): {
  supportingCount: number;
  contradictingCount: number;
  relevantArticles: PubMedArticle[];
} {
  const claimLower = claimText.toLowerCase();
  
  // Keywords that suggest support
  const supportTerms = ['benefit', 'improve', 'reduce', 'prevent', 'protect', 'effective', 'positive'];
  // Keywords that suggest contradiction
  const contradictTerms = ['no effect', 'ineffective', 'harmful', 'risk', 'danger', 'no benefit', 'myth'];
  
  let supportingCount = 0;
  let contradictingCount = 0;
  const relevantArticles: PubMedArticle[] = [];
  
  for (const article of articles) {
    const titleLower = article.title.toLowerCase();
    
    // Check keyword overlap
    const claimWords: string[] = claimLower.match(/\b\w{4,}\b/g) || [];
    const titleWords: string[] = titleLower.match(/\b\w{4,}\b/g) || [];
    const overlap = claimWords.filter(w => titleWords.includes(w));
    
    if (overlap.length >= 2) {
      relevantArticles.push(article);
      
      // Simple sentiment check on title
      const hasSupport = supportTerms.some(t => titleLower.includes(t));
      const hasContradict = contradictTerms.some(t => titleLower.includes(t));
      
      if (hasSupport && !hasContradict) supportingCount++;
      else if (hasContradict && !hasSupport) contradictingCount++;
    }
  }
  
  return { supportingCount, contradictingCount, relevantArticles };
}

/**
 * Verify a health claim using PubMed
 */
export async function verifyWithPubMed(claim: Claim, apiKey?: string): Promise<Verification | null> {
  // Only process health-related claims
  if (!isHealthClaim(claim.text)) {
    console.log('[PubMedService] Not a health claim, skipping');
    return null;
  }
  
  console.log(`[PubMedService] Checking health claim: "${claim.text.substring(0, 60)}..."`);
  
  const searchQuery = extractMedicalTerms(claim.text);
  const articleIds = await searchPubMed(searchQuery, apiKey);
  
  if (articleIds.length === 0) {
    console.log('[PubMedService] No PubMed articles found');
    return null;
  }
  
  // Small delay to respect rate limits
  await new Promise(resolve => setTimeout(resolve, 350));
  
  const articles = await getArticleSummaries(articleIds, apiKey);
  
  if (articles.length === 0) {
    console.log('[PubMedService] Could not fetch article details');
    return null;
  }
  
  const analysis = analyzeArticleRelevance(claim.text, articles);
  
  if (analysis.relevantArticles.length === 0) {
    console.log('[PubMedService] No relevant articles found');
    return null;
  }
  
  console.log(`[PubMedService] Found ${analysis.relevantArticles.length} relevant articles`);
  
  // Build evidence from articles
  const evidence: Evidence[] = analysis.relevantArticles.slice(0, 5).map(article => ({
    url: `https://pubmed.ncbi.nlm.nih.gov/${article.uid}/`,
    sourceName: `PubMed: ${article.source}`,
    quote: article.title,
    datePublished: article.pubdate,
  }));
  
  // Determine rating based on research consensus (conservative)
  let rating: Verification['rating'] = 'unverified';
  let confidence = 0.4;
  let summary = '';
  
  if (analysis.relevantArticles.length >= 3) {
    if (analysis.supportingCount > analysis.contradictingCount * 2) {
      rating = 'mostly_true';
      confidence = Math.min(0.7, 0.5 + (analysis.supportingCount * 0.05));
      summary = `Found ${analysis.relevantArticles.length} relevant PubMed studies, with ${analysis.supportingCount} appearing to support this claim.`;
    } else if (analysis.contradictingCount > analysis.supportingCount * 2) {
      rating = 'mostly_false';
      confidence = Math.min(0.7, 0.5 + (analysis.contradictingCount * 0.05));
      summary = `Found ${analysis.relevantArticles.length} relevant PubMed studies, with ${analysis.contradictingCount} appearing to contradict this claim.`;
    } else {
      rating = 'mixed';
      confidence = 0.5;
      summary = `Found ${analysis.relevantArticles.length} relevant PubMed studies with mixed findings on this claim.`;
    }
  } else {
    summary = `Found ${analysis.relevantArticles.length} potentially relevant PubMed article(s). More research may be needed to verify this claim.`;
  }
  
  const verification: Verification = {
    claimId: claim.id,
    rating,
    confidence,
    summary,
    evidence,
    checkedAt: new Date().toISOString(),
    caveats: [
      'Based on article title analysis only - full text review recommended',
      'Scientific consensus may evolve as new research emerges',
      'Individual studies may have limitations',
      'Consult healthcare professionals for medical advice',
    ],
  };
  
  return verification;
}
