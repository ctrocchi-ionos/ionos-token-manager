import axios, { type AxiosInstance } from 'axios';
import type { IonosTokenListResponse, IonosToken } from '../types/ionos.js';

const AUTH_BASE = 'https://api.ionos.com/auth/v1';

function createClient(): AxiosInstance {
  return axios.create({
    baseURL: AUTH_BASE,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authHeaders(adminToken: string) {
  return { Authorization: `Bearer ${adminToken}` };
}

function basicAuthHeaders(email: string, password: string) {
  const encoded = Buffer.from(`${email}:${password}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

export async function listTokens(adminToken: string): Promise<IonosToken[]> {
  const client = createClient();
  const resp = await client.get<IonosTokenListResponse>('/tokens', {
    headers: authHeaders(adminToken),
  });
  return resp.data.tokens ?? [];
}

export async function getToken(adminToken: string, tokenId: string): Promise<IonosToken> {
  const client = createClient();
  const resp = await client.get<IonosToken>(`/tokens/${tokenId}`, {
    headers: authHeaders(adminToken),
  });
  return resp.data;
}

export async function deleteToken(adminToken: string, tokenId: string): Promise<void> {
  const client = createClient();
  await client.delete(`/tokens/${tokenId}`, {
    headers: authHeaders(adminToken),
  });
}

export async function deleteTokenAsUser(email: string, password: string, tokenId: string): Promise<void> {
  const client = createClient();
  await client.delete(`/tokens/${tokenId}`, {
    headers: basicAuthHeaders(email, password),
  });
}

export async function deleteTokensByCriteria(adminToken: string, criteria: 'EXPIRED' | 'ALL' | 'CURRENT'): Promise<void> {
  const client = createClient();
  await client.delete(`/tokens?criteria=${criteria}`, {
    headers: authHeaders(adminToken),
  });
}

export async function generateToken(adminToken: string, ttlSeconds: number): Promise<string> {
  const client = createClient();
  const resp = await client.get('/tokens/generate', {
    params: { ttl: ttlSeconds },
    headers: authHeaders(adminToken),
  });
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
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }

  throw new Error('Failed to generate token after retries');
}
