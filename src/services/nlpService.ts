/**
 * NLP Service Client - Communicates with the Python NLP microservice
 */

import axios, { AxiosInstance } from 'axios';

const NLP_SERVICE_URL = process.env.NLP_SERVICE_URL || 'http://localhost:3002';

interface Entity {
  text: string;
  label: string;
}

interface ExtractedClaim {
  text: string;
  claim_type: string;
  confidence: number;
  entities: Entity[];
  evidence_keywords: string[];
  sentence_index: number;
  char_start: number;
  char_end: number;
}

interface ExtractClaimsResponse {
  claims: ExtractedClaim[];
  processing_time_ms: number;
  text_length: number;
  total_sentences: number;
}

interface HealthResponse {
  status: string;
  model_loaded: boolean;
  model_name: string;
}

class NlpServiceClient {
  private client: AxiosInstance;
  private isAvailable: boolean = false;
  
  constructor() {
    this.client = axios.create({
      baseURL: NLP_SERVICE_URL,
      timeout: 30000, // 30 seconds for large texts
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    // Check availability on startup
    this.checkHealth().catch(() => {
      console.log('[NLP Service] Not available, will use fallback pattern matching');
    });
  }
  
  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.client.get<HealthResponse>('/health');
      this.isAvailable = response.data.status === 'healthy';
      if (this.isAvailable) {
        console.log(`[NLP Service] Connected, model: ${response.data.model_name}`);
      }
      return this.isAvailable;
    } catch (error) {
      this.isAvailable = false;
      return false;
    }
  }
  
  /**
   * Extract claims from text using the NLP service.
   * Returns null if the service is unavailable.
   */
  async extractClaims(
    text: string, 
    url?: string, 
    maxClaims: number = 20
  ): Promise<ExtractedClaim[] | null> {
    // Check if service is available
    if (!this.isAvailable) {
      const available = await this.checkHealth();
      if (!available) {
        return null;
      }
    }
    
    try {
      const response = await this.client.post<ExtractClaimsResponse>('/extract', {
        text,
        url,
        max_claims: maxClaims,
      });
      
      console.log(
        `[NLP Service] Extracted ${response.data.claims.length} claims ` +
        `from ${response.data.total_sentences} sentences ` +
        `in ${response.data.processing_time_ms}ms`
      );
      
      return response.data.claims;
    } catch (error) {
      console.error('[NLP Service] Extraction failed:', error);
      this.isAvailable = false;
      return null;
    }
  }
  
  /**
   * Check if the NLP service is available.
   */
  get available(): boolean {
    return this.isAvailable;
  }
}

// Singleton instance
export const nlpService = new NlpServiceClient();

// Export types
export type { ExtractedClaim, Entity };
