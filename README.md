# LieDetector Backend

Express.js API server for the LieDetector browser extension. Verifies claims using multiple verification sources including Google Fact Check API, PubMed for medical claims, Wikipedia for reference information, and OpenAI GPT-4o-mini as a fallback.

## Features

- **Google Fact Check API**: Primary source for existing fact-checks from professional fact-checkers
- **PubMed Integration**: Searches scientific literature for health/medical claims
- **Wikipedia Reference**: Provides supplementary context from Wikipedia/Wikidata
- **OpenAI Fallback**: GPT-4o-mini analyzes claims when no definitive fact-checks found
- **NLP Integration**: Connects to Python NLP service for claim extraction
- **Response Caching**: Reduces API calls for repeated claims (5-minute TTL)
- **CORS Support**: Configured for browser extension requests

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   
   Required keys:
   ```env
   PORT=3001
   GOOGLE_FACT_CHECK_API_KEY=your_google_api_key
   OPENAI_API_KEY=your_openai_api_key
   NLP_SERVICE_URL=http://localhost:3002
   ```

3. Get API keys:
   - **Google Fact Check**: [Google Cloud Console](https://console.cloud.google.com/apis/credentials) - Enable "Fact Check Tools API"
   - **OpenAI**: [OpenAI Platform](https://platform.openai.com/api-keys)

4. Start the server:
   ```bash
   # Development (with hot reload)
   npm run dev
   
   # Production
   npm run build
   npm start
   ```

## API Endpoints

### POST /api/verify
Verify one or more claims.

**Request:**
```json
{
  "claims": [
    { "id": "claim_1", "text": "9 out of 10 doctors recommend..." }
  ],
  "url": "https://example.com/article"
}
```

**Response:**
```json
{
  "verifications": [
    {
      "claimId": "claim_1",
      "rating": "mostly_false",
      "confidence": 0.85,
      "summary": "This claim was rated 'Mostly False' by PolitiFact...",
      "evidence": [...],
      "lastUpdated": "2026-02-20T10:30:00Z",
      "humanReviewed": true
    }
  ],
  "cached": false,
  "meta": { "total": 1, "fromCache": 0 }
}
```

### POST /api/extract-and-verify
Extract claims using NLP and verify them.

**Request:**
```json
{
  "text": "Article text content...",
  "url": "https://example.com/article",
  "maxClaims": 10
}
```

**Response:**
```json
{
  "claims": [
    { "id": "nlp_1", "text": "Extracted claim...", "claimType": "statistic" }
  ],
  "verifications": [...],
  "extractedBy": "nlp"
}
```

### GET /api/health
Health check endpoint.

### GET /api/cache/stats
Get cache statistics.

### POST /api/cache/clear
Clear the verification cache.

## Verification Flow

1. **Check Cache**: Return cached result if available
2. **Google Fact Check API**: Search for existing professional fact-checks (most authoritative)
3. **PubMed** (health claims only): Search scientific literature for medical/health claims
4. **Wikipedia**: Retrieve supplementary reference information
5. **OpenAI Fallback**: If no fact-checks found, use GPT-4o-mini to analyze the claim
6. **Combine & Cache**: Merge results from multiple sources and cache for future requests

Results from multiple sources are intelligently combined, with Google Fact Check results taking precedence.

## Rating Scale

| Rating | Description |
|--------|-------------|
| `verified` | Confirmed true by fact-checkers |
| `mostly_true` | Mostly accurate with minor issues |
| `mixed` | Contains both true and false elements |
| `mostly_false` | Mostly inaccurate |
| `false` | Confirmed false by fact-checkers |
| `unverified` | No fact-checks found, unable to verify |
| `opinion` | Subjective statement, not verifiable |
| `outdated` | Was true but no longer accurate |

## Project Structure

```
backend/
├── src/
│   ├── index.ts           # Express server entry point
│   ├── routes/
│   │   └── api.ts         # API route handlers
│   └── services/
│       ├── verificationService.ts  # Main verification orchestration
│       ├── googleFactCheck.ts      # Google Fact Check API
│       ├── pubmedService.ts        # PubMed/NCBI for health claims
│       ├── wikipediaService.ts     # Wikipedia reference lookup
│       └── openaiService.ts        # OpenAI LLM fallback
├── package.json
├── tsconfig.json
└── .env.example
```

## NLP Service Integration

The backend connects to a separate Python NLP service for claim extraction:

```
Backend (3001) <---> NLP Service (3002)
```

When `/api/extract-and-verify` is called:
1. Backend sends text to NLP service
2. NLP service extracts claims using NLTK
3. Backend verifies extracted claims
4. Results returned to extension

See [../nlp-service/README.md](../nlp-service/README.md) for NLP service setup.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3001) |
| `GOOGLE_FACT_CHECK_API_KEY` | Yes | Google Fact Check Tools API key |
| `OPENAI_API_KEY` | Yes | OpenAI API key for GPT-4o-mini fallback |
| `PUBMED_API_KEY` | No | NCBI API key for higher rate limits (optional, works without) |
| `NLP_SERVICE_URL` | No | NLP service URL (default: http://localhost:3002) |
| `NODE_ENV` | No | Environment (development/production) |

### Getting API Keys

- **Google Fact Check**: [Google Cloud Console](https://console.cloud.google.com/apis/credentials) - Enable "Fact Check Tools API"
- **OpenAI**: [OpenAI Platform](https://platform.openai.com/api-keys)
- **PubMed (optional)**: [NCBI API Keys](https://ncbiinsights.ncbi.nlm.nih.gov/2017/11/02/new-api-keys-for-the-e-utilities/) - Increases rate limit from 3 to 10 requests/second
