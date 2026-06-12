import axios from 'axios';
import { logger, authRefreshCounter } from '../telemetry/index.js';

export interface AdobeCredentials {
  CLIENT_SECRET: string;
  API_KEY: string;
  TECHNICAL_ACCOUNT_ID: string;
  IMS: string;
  IMS_ORG: string;
  SCOPES?: string[];
  ACCESS_TOKEN?: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

// Refresh 5 minutes before expiry
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
// Default token TTL if not returned by IMS (23h)
const DEFAULT_TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

export class TokenManager {
  private cache: TokenCache | null = null;
  private credentials: AdobeCredentials | null = null;
  private refreshPromise: Promise<string> | null = null;

  setCredentials(creds: AdobeCredentials): void {
    this.credentials = creds;
    this.cache = null;
    // If a direct access token is provided, cache it with default TTL
    if (creds.ACCESS_TOKEN) {
      this.cache = {
        accessToken: creds.ACCESS_TOKEN,
        expiresAt: Date.now() + DEFAULT_TOKEN_TTL_MS
      };
      logger.info('Using provided access token');
    }
  }

  isConfigured(): boolean {
    return this.credentials !== null;
  }

  async getToken(): Promise<string> {
    if (!this.credentials) {
      throw new Error('TokenManager not configured. Upload credentials first.');
    }

    // Return cached token if still valid
    if (this.cache && this.cache.expiresAt - Date.now() > REFRESH_THRESHOLD_MS) {
      return this.cache.accessToken;
    }

    // Deduplicate concurrent refresh calls
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.fetchToken().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async fetchToken(): Promise<string> {
    if (!this.credentials) throw new Error('No credentials configured');

    const { CLIENT_SECRET, API_KEY, TECHNICAL_ACCOUNT_ID, IMS, IMS_ORG, SCOPES } = this.credentials;

    // If we already have a pre-supplied token (no client secret for OAuth), reuse it
    if (!CLIENT_SECRET || CLIENT_SECRET === 'placeholder123') {
      if (this.cache?.accessToken) return this.cache.accessToken;
      throw new Error('No client secret configured and no cached token available');
    }

    logger.info('Fetching new Adobe IMS access token');
    authRefreshCounter.inc();

    const scopes = Array.isArray(SCOPES) ? SCOPES.join(',') : (SCOPES || 'openid,AdobeID,read_organizations');
    const imsHost = IMS || 'ims-na1.adobelogin.com';

    try {
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: API_KEY,
        client_secret: CLIENT_SECRET,
        scope: scopes
      });

      const response = await axios.post(
        `https://${imsHost}/ims/token/v3`,
        params.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000
        }
      );

      const { access_token, expires_in } = response.data;
      const ttl = (expires_in ? expires_in * 1000 : DEFAULT_TOKEN_TTL_MS);

      this.cache = {
        accessToken: access_token,
        expiresAt: Date.now() + ttl
      };

      logger.info('Access token acquired', { expiresInSeconds: expires_in });
      return access_token;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to fetch IMS token', { error: msg });
      throw new Error(`Authentication failed: ${msg}`);
    }
  }

  clearCache(): void {
    this.cache = null;
  }

  reset(): void {
    this.credentials = null;
    this.cache = null;
    this.refreshPromise = null;
  }

  getStatus(): { configured: boolean; tokenCached: boolean; expiresAt?: string } {
    return {
      configured: this.credentials !== null,
      tokenCached: this.cache !== null,
      expiresAt: this.cache ? new Date(this.cache.expiresAt).toISOString() : undefined
    };
  }
}

// Singleton instance
export const tokenManager = new TokenManager();
