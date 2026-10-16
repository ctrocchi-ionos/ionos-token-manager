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

// API response format for managed token
export interface ManagedTokenResponse {
  id: string;
  accountId: string;
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

export interface PermissionTemplateResponse {
  id: string;
  name: string;
  description: string | null;
  permissions: PermissionFlags;
  sharedResourceTypes: string[];
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

// Audit log
export interface AuditLogResponse {
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
