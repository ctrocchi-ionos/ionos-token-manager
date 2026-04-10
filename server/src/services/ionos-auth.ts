import axios, { type AxiosInstance } from 'axios';
import { config } from '../config.js';
import type { IonosTokenListResponse, IonosToken } from '../types/ionos.js';

const AUTH_BASE = 'https://api.ionos.com/auth/v1';

function createClient(): AxiosInstance {
  return axios.create({
    baseURL: AUTH_BASE,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authHeaders(token?: string) {
  return { Authorization: `Bearer ${token ?? config.getAdminToken()}` };
}

function basicAuthHeaders(email: string, password: string) {
  const encoded = Buffer.from(`${email}:${password}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

export async function listTokens(token?: string): Promise<IonosToken[]> {
  const client = createClient();
  const resp = await client.get<IonosTokenListResponse>('/tokens', {
    headers: authHeaders(token),
  });
  return resp.data.tokens ?? [];
}

export async function getToken(tokenId: string, token?: string): Promise<IonosToken> {
  const client = createClient();
  const resp = await client.get<IonosToken>(`/tokens/${tokenId}`, {
    headers: authHeaders(token),
  });
  return resp.data;
}

export async function deleteToken(tokenId: string, token?: string): Promise<void> {
  const client = createClient();
  await client.delete(`/tokens/${tokenId}`, {
    headers: authHeaders(token),
  });
}

export async function deleteTokensByCriteria(criteria: 'EXPIRED' | 'ALL' | 'CURRENT', token?: string): Promise<void> {
  const client = createClient();
  await client.delete(`/tokens?criteria=${criteria}`, {
    headers: authHeaders(token),
  });
}

export async function generateToken(ttlSeconds: number, token?: string): Promise<string> {
  const client = createClient();
  const resp = await client.get('/tokens/generate', {
    params: { ttl: ttlSeconds },
    headers: authHeaders(token),
  });
  // The response could be { token: "..." } or just the JWT string
  if (typeof resp.data === 'string') return resp.data;
  if (resp.data.token) return resp.data.token;
  throw new Error('Unexpected token generate response format');
}

export async function generateTokenAsUser(
  email: string,
  password: string,
  ttlSeconds: number,
  maxRetries = 5,
): Promise<string> {
  const client = createClient();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = await client.get('/tokens/generate', {
        params: { ttl: ttlSeconds },
        headers: basicAuthHeaders(email, password),
      });
      if (typeof resp.data === 'string') return resp.data;
      if (resp.data.token) return resp.data.token;
      throw new Error('Unexpected token generate response format');
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 401 && attempt < maxRetries - 1) {
        // User may not have propagated yet — wait and retry
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }

  throw new Error('Failed to generate token after retries');
}
