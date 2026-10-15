// Permission flags (matches IONOS group properties)
export interface PermissionFlags {
  createDataCenter?: boolean;
  createSnapshot?: boolean;
  reserveIp?: boolean;
  accessActivityLog?: boolean;
  createPcc?: boolean;
  s3Privilege?: boolean;
  createBackupUnit?: boolean;
  createInternetAccess?: boolean;
  createK8sCluster?: boolean;
  createFlowLog?: boolean;
  accessAndManageMonitoring?: boolean;
  accessAndManageCertificates?: boolean;
  accessAndManageLogging?: boolean;
  manageDBaaS?: boolean;
  accessAndManageDns?: boolean;
  manageRegistry?: boolean;
  accessAndManageCdn?: boolean;
  accessAndManageVpn?: boolean;
  accessAndManageApiGateway?: boolean;
  accessAndManageKaas?: boolean;
  accessAndManageNetworkFileStorage?: boolean;
  accessAndManageAiModelHub?: boolean;
  createNetworkSecurityGroups?: boolean;
  accessAndManageIamResources?: boolean;
  manageDataplatform?: boolean;
}

export interface SharedResource {
  resourceId: string;
  type: string;
  name: string;
  editPrivilege: boolean;
  sharePrivilege: boolean;
}

// Managed token (DB row)
export interface ManagedToken {
  id: string;
  name: string;
  description: string | null;
  ionos_token_id: string | null;
  ionos_user_id: string;
  ionos_group_id: string;
  sub_user_email: string;
  sub_user_password_enc: string;
  permissions: string; // JSON string of PermissionFlags
  shared_resources: string; // JSON string of SharedResource[]
  template_id: string | null;
  ttl_seconds: number;
  created_at: string;
  expires_at: string;
  last_regenerated_at: string | null;
  cleaned_up_at: string | null;
  status: 'active' | 'expired' | 'revoked' | 'error';
  cleanup_on_delete: number;
  owner_email: string;
}

// API response format for managed token
export interface ManagedTokenResponse {
  id: string;
  name: string;
  description: string | null;
  ionosTokenId: string | null;
  ionosUserId: string;
  ionosGroupId: string;
  subUserEmail: string;
  permissions: PermissionFlags;
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

// Token creation request
export interface CreateTokenRequest {
  name: string;
  description?: string;
  permissions: PermissionFlags;
  sharedResources?: SharedResource[];
  ttlSeconds: number;
  templateId?: string;
  cleanupOnDelete?: boolean;
}

// Token creation result (includes the JWT shown once)
export interface CreateTokenResult extends ManagedTokenResponse {
  tokenValue: string;
}

// Permission template
export interface PermissionTemplate {
  id: string;
  name: string;
  description: string | null;
  permissions: string; // JSON string
  shared_resource_types: string; // JSON string
  is_builtin: number;
  owner_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface PermissionTemplateResponse {
  id: string;
  name: string;
  description: string | null;
  permissions: PermissionFlags;
  sharedResourceTypes: string[];
  isBuiltin: boolean;
  ownerEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

// Audit log
export interface AuditLogEntry {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: string | null; // JSON
  ionos_request_ids: string | null; // JSON
  success: number;
  error_message: string | null;
  created_at: string;
  actor_email: string | null;
}

export interface AuditLogResponse {
  id: number;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ionosRequestIds: string[] | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

// Per-user IONOS admin token
export interface UserAdminToken {
  owner_email: string;
  current_token_enc: string;
  token_id: string | null;
  issued_at: string;
  expires_at: string;
  updated_at: string;
}

// Admin token state
export interface AdminTokenState {
  id: number;
  current_token_enc: string;
  token_id: string | null;
  issued_at: string;
  expires_at: string;
  renewal_ttl_seconds: number;
  renewal_threshold_seconds: number;
  last_renewal_at: string | null;
  last_renewal_error: string | null;
  auto_renew_enabled: number;
}

// API standard response
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  pagination?: { total: number; page: number; limit: number };
}
