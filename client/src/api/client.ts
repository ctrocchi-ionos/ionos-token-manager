const BASE_URL = '/api';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  pagination?: { total: number; page: number; limit: number };
}

class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let currentAccountId: string | null = null;

/** The DCD account every account-scoped call is made for (set by AccountProvider). */
export function setCurrentAccountId(id: string | null): void {
  currentAccountId = id;
}

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set('X-Requested-With', 'token-manager');
  if (currentAccountId) headers.set('X-DCD-Account', currentAccountId);
  return headers;
}

/** fetch() against the API with the CSRF and account headers. Use for downloads. */
export function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, { ...options, headers: buildHeaders(options?.headers) });
}

async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const headers = buildHeaders(options?.headers);
  headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // Handle non-JSON responses (like CSV exports)
  const contentType = res.headers.get('content-type');
  if (contentType?.includes('text/csv')) {
    const text = await res.text();
    return { success: true, data: text as unknown as T };
  }

  const json: ApiResponse<T> = await res.json();
  if (!json.success) {
    throw new ApiError(
      json.error?.message ?? 'Request failed',
      json.error?.code ?? 'UNKNOWN',
      res.status,
      json.error?.details,
    );
  }
  return json;
}

// ── Tokens ──

export interface ManagedToken {
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  ionosTokenId: string | null;
  ionosUserId: string;
  ionosGroupId: string;
  subUserEmail: string;
  permissions: Record<string, boolean>;
  sharedResources: SharedResource[];
  templateId: string | null;
  ttlSeconds: number;
  createdAt: string;
  expiresAt: string;
  lastRegeneratedAt: string | null;
  status: string;
  cleanupOnDelete: boolean;
  cleanedUpAt: string | null;
}

export interface SharedResource {
  resourceId: string;
  type: string;
  name: string;
  editPrivilege: boolean;
  sharePrivilege: boolean;
}

export interface CreateTokenPayload {
  name: string;
  description?: string;
  permissions: Record<string, boolean>;
  sharedResources?: SharedResource[];
  ttlSeconds: number;
  templateId?: string;
  cleanupOnDelete?: boolean;
}

export interface TokenStats {
  active: number;
  expiringSoon: number;
  expired: number;
  revoked: number;
  total: number;
}

export async function listTokens(params?: {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const qstr = qs.toString();
  return request<ManagedToken[]>(`/tokens${qstr ? `?${qstr}` : ''}`);
}

export async function getToken(id: string) {
  return request<ManagedToken>(`/tokens/${id}`);
}

export async function getTokenStats() {
  return request<TokenStats>('/tokens/stats');
}

export async function createToken(payload: CreateTokenPayload) {
  return request<ManagedToken & { tokenValue: string }>('/tokens', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function regenerateToken(id: string) {
  return request<{ tokenValue: string; expiresAt: string }>(`/tokens/${id}/regenerate`, {
    method: 'POST',
  });
}

export async function revokeToken(id: string) {
  return request<{ message: string }>(`/tokens/${id}`, { method: 'DELETE' });
}

export async function dismissToken(id: string) {
  return request<{ message: string }>(`/tokens/${id}/dismiss`, { method: 'DELETE' });
}

export async function bulkDeleteTokens(criteria: 'expired' | 'ids', ids?: string[]) {
  return request<{ deleted: number; errors: string[] }>('/tokens/bulk-delete', {
    method: 'POST',
    body: JSON.stringify(criteria === 'expired' ? { criteria } : { ids }),
  });
}

export async function exportTokens(format: 'json' | 'csv') {
  return apiFetch(`/tokens/export?format=${format}`);
}

// ── Templates ──

export interface PermissionTemplate {
  id: string;
  name: string;
  description: string | null;
  permissions: Record<string, boolean>;
  sharedResourceTypes: string[];
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listTemplates() {
  return request<PermissionTemplate[]>('/templates');
}

export async function createTemplate(payload: {
  name: string;
  description?: string;
  permissions: Record<string, boolean>;
  sharedResourceTypes?: string[];
}) {
  return request<PermissionTemplate>('/templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteTemplate(id: string) {
  return request<{ message: string }>(`/templates/${id}`, { method: 'DELETE' });
}

// ── Resources ──

export interface DatacenterInfo {
  id: string;
  name: string;
  description: string | null;
  location: string;
}

export interface ResourceInfo {
  id: string;
  type: string;
  name: string;
}

export async function listDatacenters() {
  return request<DatacenterInfo[]>('/resources/datacenters');
}

export async function listResources(type?: string) {
  return request<ResourceInfo[]>(type ? `/resources/${type}` : '/resources/all');
}

// ── Current User ──

export async function getMe() {
  return request<{ email: string }>('/me');
}

// ── DCD accounts ──

export interface DcdAccount {
  id: string;
  label: string;
  contractNumber: number;
  hasToken: boolean;
  tokenId: string | null;
  expiresAt: string | null;
  daysRemaining: number;
  tokensHoldingAccess: number;
  updatedAt: string;
  expired: boolean;
}

export async function listDcdAccounts() {
  return request<DcdAccount[]>('/dcd-accounts');
}

export async function addDcdAccount(label: string, token: string) {
  return request<DcdAccount>('/dcd-accounts', { method: 'POST', body: JSON.stringify({ label, token }) });
}

export async function replaceDcdAccountToken(id: string, token: string) {
  return request<DcdAccount>(`/dcd-accounts/${id}/token`, { method: 'PUT', body: JSON.stringify({ token }) });
}

export async function renameDcdAccount(id: string, label: string) {
  return request<DcdAccount>(`/dcd-accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ label }) });
}

export async function removeDcdAccount(id: string) {
  return request<{ message: string }>(`/dcd-accounts/${id}`, { method: 'DELETE' });
}

// ── Admin ──

export interface AdminTokenStatus {
  tokenId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number;
  lastUpdatedAt: string | null;
}

export interface HealthInfo {
  status: string;
  dbConnected: boolean;
}

export async function checkNeedsSetup() {
  return request<{ needsSetup: boolean }>('/admin/needs-setup');
}

export async function submitSetup(token: string) {
  return request<{ message: string }>('/admin/setup', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function getHealth() {
  return request<HealthInfo>('/admin/health');
}

export async function getAdminTokenStatus() {
  return request<AdminTokenStatus>('/admin/token-status');
}

export async function updateAdminToken(token: string) {
  return request<{ message: string }>('/admin/token', {
    method: 'PUT',
    body: JSON.stringify({ token }),
  });
}

// ── Account ──

export interface AccountUser {
  ionosUserId: string;
  email: string;
  firstname: string;
  lastname: string;
  admin: boolean;
  active: boolean;
  createdDate: string | null;
  category: 'admin' | 'managed' | 'external';
  managedTokenId?: string;
  managedTokenName?: string;
  managedTokenStatus?: string;
  possiblyFormerManaged?: boolean;
  adminTokenStatus?: {
    expiresAt: string | null;
    daysRemaining: number;
    lastUpdatedAt: string | null;
  };
}

export interface OrphanToken {
  tokenId: string;
  createdDate: string | null;
  expirationDate: string | null;
  expired: boolean;
}

export interface AccountData {
  contractNumber: number;
  adminUserId: string;
  users: AccountUser[];
  summary: { total: number; admin: number; managed: number; external: number };
  orphanTokens: OrphanToken[];
}

export async function getAccountUsers() {
  return request<AccountData>('/account/users');
}

export async function deleteExternalUser(userId: string) {
  return request<{ message: string }>(`/account/external-users/${userId}`, { method: 'DELETE' });
}

// ── Audit ──

export interface AuditEntry {
  id: number;
  accountId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export async function listAuditLog(params?: {
  action?: string;
  entityType?: string;
  page?: number;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.action) qs.set('action', params.action);
  if (params?.entityType) qs.set('entityType', params.entityType);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const qstr = qs.toString();
  return request<AuditEntry[]>(`/audit${qstr ? `?${qstr}` : ''}`);
}
