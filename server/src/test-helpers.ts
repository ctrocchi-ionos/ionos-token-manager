import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { encryptWith } from './services/crypto.js';
import * as q from './workspace/queries.js';
import type { Workspace } from './workspace/registry.js';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** An unsigned JWT shaped like an IONOS token (the app never verifies signatures; IONOS does). */
export function fakeJwt(opts: { contractNumber: number; uuid?: string; kid?: string; expInSeconds?: number }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'RS256', kid: opts.kid ?? uuidv4() };
  const payload = {
    iss: 'ionos', iat: now, exp: now + (opts.expInSeconds ?? 86400), client: 'test',
    identity: { isParent: false, privileges: [], uuid: opts.uuid ?? uuidv4(), resellerId: 1, regDomain: 'ionos.de', role: 'admin', contractNumber: opts.contractNumber },
  };
  return `${b64(header)}.${b64(payload)}.sig`;
}

/** Route every axios call through `handler`. Returns the list of "METHOD url" calls made. */
export function mockIonos(handler: (method: string, url: string, body?: unknown) => { status: number; data?: unknown }): string[] {
  const calls: string[] = [];
  const respond = async (method: string, url: string, body?: unknown) => {
    calls.push(`${method} ${url}`);
    const r = handler(method, url, body);
    if (r.status >= 400) {
      const e = new Error(`HTTP ${r.status}`) as Error & { isAxiosError: boolean; response: { status: number } };
      e.isAxiosError = true;
      e.response = { status: r.status };
      throw e;
    }
    return { status: r.status, headers: {}, data: r.data ?? {} };
  };
  (axios as unknown as { create: () => unknown }).create = () => ({
    get: (url: string) => respond('GET', url),
    delete: (url: string) => respond('DELETE', url),
    post: (url: string, body?: unknown) => respond('POST', url, body),
  });
  return calls;
}

/** Insert a DCD account straight into the workspace (bypasses IONOS verification). */
export function addTestAccount(ws: Workspace, contractNumber: number, opts: { expired?: boolean; noToken?: boolean } = {}): string {
  const id = uuidv4();
  const expires = new Date(Date.now() + (opts.expired ? -1 : 1) * 86400_000).toISOString();
  q.insertAccount(ws.db, {
    id, label: `Contract ${contractNumber}`, contract_number: contractNumber, admin_user_id: 'admin-uuid',
    token_enc: opts.noToken ? null : encryptWith(ws.key, fakeJwt({ contractNumber })),
    token_id: opts.noToken ? null : 'admin-kid', issued_at: new Date().toISOString(), expires_at: opts.noToken ? null : expires,
  });
  return id;
}
