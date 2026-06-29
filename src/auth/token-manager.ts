import axios from 'axios';
import { createHash } from 'crypto';
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

/**
 * Acquire an Adobe IMS access token directly from a set of credentials, WITHOUT
 * touching the shared tokenManager singleton. Used by the setup-time probe
 * endpoints (sandbox discovery, tenant detection), which validate freshly-uploaded
 * credentials before the user has committed to a configuration — they must never
 * mutate the credentials/cache that an already-configured live MCP session depends
 * on. Returns the IMS-reported TTL so a caller that does cache it (the singleton)
 * can honor the real expiry instead of assuming the default.
 */
export async function acquireImsToken(
  creds: AdobeCredentials
): Promise<{ accessToken: string; expiresInSeconds?: number }> {
  const { CLIENT_SECRET, API_KEY, IMS, SCOPES, ACCESS_TOKEN } = creds;

  // A pre-supplied access token (no client secret to exchange) is used as-is.
  if (!CLIENT_SECRET || CLIENT_SECRET === 'placeholder123') {
    if (ACCESS_TOKEN) return { accessToken: ACCESS_TOKEN };
    throw new Error('No client secret configured and no access token provided');
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
    logger.info('Access token acquired', { expiresInSeconds: expires_in });
    return { accessToken: access_token, expiresInSeconds: expires_in };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to fetch IMS token', { error: msg });
    throw new Error(`Authentication failed: ${msg}`);
  }
}

// ─── Probe token cache ───────────────────────────────────────────────────────

// The setup-time probe endpoints (sandbox discovery, tenant detection) and the
// initial validation in /api/configure all authenticate the SAME freshly-uploaded
// credentials within seconds of each other. They must not use the tokenManager
// singleton (it serves the live MCP session and would be clobbered by probing
// different creds), but re-hitting IMS for each is wasteful. This standalone cache,
// keyed by a hash of the credential fields that determine the token, lets those
// calls share one token until it nears expiry — without ever touching the singleton.
interface ProbeEntry { accessToken: string; expiresAt: number; }
const probeTokenCache = new Map<string, ProbeEntry>();
const probeInflight = new Map<string, Promise<ProbeEntry>>();

function probeKey(creds: AdobeCredentials): string {
  const material = [
    creds.API_KEY, creds.CLIENT_SECRET, creds.IMS, creds.IMS_ORG,
    Array.isArray(creds.SCOPES) ? creds.SCOPES.join(',') : (creds.SCOPES || ''),
    creds.ACCESS_TOKEN || ''
  ].join('|');
  // Hash so a credential secret is never used as (or exposed via) a map key.
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Acquire an IMS token for uncommitted credentials, reusing a recently-fetched one
 * for the same credentials when available. Backed by a process-local cache that is
 * SEPARATE from the tokenManager singleton, so it can dedupe the setup-flow token
 * fetches without any risk of disturbing an already-configured live session.
 * Returns the REMAINING TTL so a caller can prime another cache accurately.
 */
export async function acquireProbeToken(
  creds: AdobeCredentials
): Promise<{ accessToken: string; expiresInSeconds?: number }> {
  const key = probeKey(creds);
  const now = Date.now();

  // Opportunistically drop expired entries (the map only ever holds a handful).
  for (const [k, v] of probeTokenCache) {
    if (v.expiresAt <= now) probeTokenCache.delete(k);
  }

  const cached = probeTokenCache.get(key);
  if (cached && cached.expiresAt - now > REFRESH_THRESHOLD_MS) {
    return { accessToken: cached.accessToken, expiresInSeconds: Math.floor((cached.expiresAt - now) / 1000) };
  }

  // Coalesce concurrent probes for the same credentials onto one IMS call.
  let inflight = probeInflight.get(key);
  if (!inflight) {
    inflight = (async () => {
      const { accessToken, expiresInSeconds } = await acquireImsToken(creds);
      const ttl = expiresInSeconds ? expiresInSeconds * 1000 : DEFAULT_TOKEN_TTL_MS;
      const entry: ProbeEntry = { accessToken, expiresAt: Date.now() + ttl };
      probeTokenCache.set(key, entry);
      return entry;
    })().finally(() => probeInflight.delete(key));
    probeInflight.set(key, inflight);
  }

  const entry = await inflight;
  return { accessToken: entry.accessToken, expiresInSeconds: Math.floor((entry.expiresAt - Date.now()) / 1000) };
}

/** Drop all cached probe tokens (e.g. on server deactivation). */
export function clearProbeTokenCache(): void {
  probeTokenCache.clear();
  probeInflight.clear();
}

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

  // Seed the cache with a token already obtained for these credentials elsewhere
  // (e.g. the setup-phase probe cache), so the first getToken() after configuring
  // reuses it instead of making a redundant IMS call. No-op until credentials are set.
  primeToken(accessToken: string, expiresInSeconds?: number): void {
    if (!this.credentials) return;
    const ttl = expiresInSeconds ? expiresInSeconds * 1000 : DEFAULT_TOKEN_TTL_MS;
    this.cache = { accessToken, expiresAt: Date.now() + ttl };
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

    const { CLIENT_SECRET } = this.credentials;

    // If we already have a pre-supplied token (no client secret for OAuth), reuse it
    if (!CLIENT_SECRET || CLIENT_SECRET === 'placeholder123') {
      if (this.cache?.accessToken) return this.cache.accessToken;
      throw new Error('No client secret configured and no cached token available');
    }

    const { accessToken, expiresInSeconds } = await acquireImsToken(this.credentials);
    const ttl = expiresInSeconds ? expiresInSeconds * 1000 : DEFAULT_TOKEN_TTL_MS;
    this.cache = {
      accessToken,
      expiresAt: Date.now() + ttl
    };
    return accessToken;
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
