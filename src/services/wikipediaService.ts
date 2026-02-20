/**
 * Wikipedia/Wikidata Verification Service
 * 
 * Uses Wikipedia API to verify factual claims about entities, dates, events, statistics.
 * Free to use, no API key required.
 * 
 * Documentation: https://www.mediawiki.org/wiki/API:Main_page
 */

import axios from 'axios';
import { Claim, Verification, Evidence, Rating } from '../types';

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

// Wikipedia requires a descriptive User-Agent per their policy
// https://meta.wikimedia.org/wiki/User-Agent_policy
const USER_AGENT = 'LieDetector/1.0 (https://github.com/LieDetector; fact-checking browser extension)';

interface WikiSearchResult {
  pageid: number;
  title: string;
  snippet: string;
  timestamp: string;
}

interface WikiPage {
  pageid: number;
  title: string;
  extract?: string;
  fullurl?: string;
}

/**
 * Extract key entities and numbers from claim text
 */
function extractSearchTerms(claimText: string): string {
  // Remove common claim phrases to get to the core content
  const cleaned = claimText
    .replace(/according to|studies show|research indicates|experts say|it is known that/gi, '')
    .replace(/approximately|about|around|nearly|over|more than|less than/gi, '')
    .trim();
  
  // For Wikipedia, shorter queries often work better
  // Try to extract the main subject
  const words = cleaned.split(/\s+/);
  if (words.length > 10) {
    // Take first 10 words for search
    return words.slice(0, 10).join(' ');
  }
  
  return cleaned;
}

/**
 * Search Wikipedia for relevant articles
 */
async function searchWikipedia(query: string): Promise<WikiSearchResult[]> {
  try {
    const response = await axios.get(WIKIPEDIA_API, {
      params: {
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: 5,
        format: 'json',
        origin: '*',
      },
      headers: {
        'User-Agent': USER_AGENT,
      },
      timeout: 10000,
    });
    
    return response.data?.query?.search || [];
  } catch (error) {
    console.error('[WikipediaService] Search error:', error);
    return [];
  }
}

/**
 * Get Wikipedia page extract
 */
async function getPageExtract(pageId: number): Promise<WikiPage | null> {
  try {
    const response = await axios.get(WIKIPEDIA_API, {
      params: {
        action: 'query',
        pageids: pageId,
        prop: 'extracts|info',
        exintro: true,
        explaintext: true,
        inprop: 'url',
        format: 'json',
        origin: '*',
      },
      headers: {
        'User-Agent': USER_AGENT,
      },
      timeout: 10000,
    });
    
    const pages = response.data?.query?.pages;
    if (pages && pages[pageId]) {
      return pages[pageId];
    }
    return null;
  } catch (error) {
    console.error('[WikipediaService] Page extract error:', error);
    return null;
  }
}

/**
 * Check if the claim content appears to be supported by Wikipedia content
 */
function analyzeRelevance(claimText: string, wikiContent: string): {
  isRelevant: boolean;
  matchScore: number;
  matchedTerms: string[];
} {
  const claimLower = claimText.toLowerCase();
  const wikiLower = wikiContent.toLowerCase();
  
  // Extract numbers from claim
  const claimNumbers: string[] = claimText.match(/\d[\d,.]*/g) || [];
  const wikiNumbers: string[] = wikiContent.match(/\d[\d,.]*/g) || [];
  
  // Check for number matches
  const matchedNumbers = claimNumbers.filter(n => wikiNumbers.includes(n));
  
  // Extract key terms (words > 4 chars, not common)
  const stopWords = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'were', 'they', 'their', 'about', 'which', 'would', 'could', 'should', 'there', 'these', 'those']);
  const claimWords = claimLower.match(/\b\w{5,}\b/g) || [];
  const significantWords = claimWords.filter(w => !stopWords.has(w));
  
  const matchedTerms = significantWords.filter(term => wikiLower.includes(term));
  
  // Calculate match score
  const termMatchRatio = significantWords.length > 0 
    ? matchedTerms.length / significantWords.length 
    : 0;
  const numberMatchRatio = claimNumbers.length > 0 
    ? matchedNumbers.length / claimNumbers.length 
    : 0;
  
  const matchScore = (termMatchRatio * 0.6) + (numberMatchRatio * 0.4);
  
  return {
    isRelevant: matchScore > 0.3 || matchedNumbers.length > 0,
    matchScore,
    matchedTerms: [...matchedTerms, ...matchedNumbers],
  };
}

/**
 * Verify a claim using Wikipedia
 */
export async function verifyWithWikipedia(claim: Claim): Promise<Verification | null> {
  console.log(`[WikipediaService] Checking: "${claim.text.substring(0, 60)}..."`);
  
  const searchQuery = extractSearchTerms(claim.text);
  const searchResults = await searchWikipedia(searchQuery);
  
  if (searchResults.length === 0) {
    console.log('[WikipediaService] No Wikipedia articles found');
    return null;
  }
  
  const evidence: Evidence[] = [];
  let bestMatch: { page: WikiPage; relevance: ReturnType<typeof analyzeRelevance> } | null = null;
  
  // Check top 3 results for relevance
  for (const result of searchResults.slice(0, 3)) {
    const page = await getPageExtract(result.pageid);
    if (!page?.extract) continue;
    
    const relevance = analyzeRelevance(claim.text, page.extract);
    
    if (relevance.isRelevant) {
      evidence.push({
        url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
        sourceName: `Wikipedia: ${page.title}`,
        quote: page.extract.substring(0, 300) + (page.extract.length > 300 ? '...' : ''),
        datePublished: result.timestamp,
      });
      
      if (!bestMatch || relevance.matchScore > bestMatch.relevance.matchScore) {
        bestMatch = { page, relevance };
      }
    }
  }
  
  if (evidence.length === 0) {
    console.log('[WikipediaService] No relevant Wikipedia content found');
    return null;
  }
  
  console.log(`[WikipediaService] Found ${evidence.length} relevant Wikipedia source(s)`);
  
  // Wikipedia can provide supporting information but shouldn't definitively verify/refute
  // It's best used as supplementary evidence
  const verification: Verification = {
    claimId: claim.id,
    rating: 'unverified', // Wikipedia alone doesn't confirm truth
    confidence: Math.min(0.5, bestMatch?.relevance.matchScore || 0.3),
    summary: `Found relevant information in Wikipedia article "${bestMatch?.page.title}". Key matching terms: ${bestMatch?.relevance.matchedTerms.slice(0, 5).join(', ')}. Note: Wikipedia provides reference information but may not definitively verify this specific claim.`,
    evidence,
    checkedAt: new Date().toISOString(),
    caveats: [
      'Wikipedia is a reference source, not a fact-checker',
      'Information should be verified with primary sources',
      'Wikipedia content can be edited by anyone',
    ],
  };
  
  return verification;
}

/**
 * Search Wikidata for structured data about entities
 */
export async function searchWikidata(query: string): Promise<any[]> {
  try {
    const response = await axios.get(WIKIDATA_API, {
      params: {
        action: 'wbsearchentities',
        search: query,
        language: 'en',
        limit: 5,
        format: 'json',
        origin: '*',
      },
      timeout: 10000,
    });
    
    return response.data?.search || [];
  } catch (error) {
    console.error('[WikipediaService] Wikidata search error:', error);
    return [];
  }
}
