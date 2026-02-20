# LieDetector Backend

Provides the fact-checking API for the LieDetector browser extension.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure your API key:
   - Copy `.env.example` to `.env`
   - Get a Google Fact Check Tools API key from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - Enable the "Fact Check Tools API" in your Google Cloud project
   - Add your key to `.env`: `GOOGLE_FACT_CHECK_API_KEY=your_key_here`

3. Start the server:
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
      "summary": "PolitiFact rated this claim as 'Mostly False'...",
      "evidence": [...],
      "checkedAt": "2026-02-19T10:30:00Z"
    }
  ],
  "cached": false,
  "meta": { "total": 1, "fromCache": 0 }
}
```

### GET /api/health
Health check endpoint.

### GET /api/cache/stats
Get cache statistics.

### POST /api/cache/clear
Clear the verification cache.

## Rating Scale

| Rating | Description |
|--------|-------------|
| `verified` | Confirmed true |
| `mostly_true` | Mostly accurate with minor issues |
| `mixed` | Contains both true and false elements |
| `mostly_false` | Mostly inaccurate |
| `false` | Confirmed false |
| `unverified` | No fact-checks found |
| `opinion` | Subjective statement |
| `outdated` | Was true but no longer accurate |

## Adding More Sources

To add additional fact-checking sources, create a new service in `src/services/` and call it from `verificationService.ts`.
