// IONOS Auth API types
export interface IonosToken {
  id: string;
  href: string;
  createdDate: string;
  expirationDate: string;
}

export interface IonosTokenListResponse {
  tokens: IonosToken[];
}

export interface IonosTokenGenerateResponse {
  token: string;
}

// IONOS Cloud API types
export interface IonosUserProperties {
  firstname: string;
  lastname: string;
  email: string;
  password?: string;
  administrator: boolean;
  active: boolean;
  forceSecAuth: boolean;
  secAuthActive?: boolean;
  s3CanonicalUserId?: string;
}

export interface IonosUser {
  id: string;
  type: string;
  href: string;
  metadata?: IonosMetadata;
  properties: IonosUserProperties;
}

export interface IonosUserListResponse {
  id: string;
  type: string;
  items: IonosUser[];
}

export interface IonosGroupProperties {
  name: string;
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

export interface IonosGroup {
  id: string;
  type: string;
  href: string;
  metadata?: IonosMetadata;
  properties: IonosGroupProperties;
}

export interface IonosGroupListResponse {
  id: string;
  type: string;
  items: IonosGroup[];
}

export interface IonosMetadata {
  etag?: string;
  createdDate?: string;
  createdBy?: string;
  createdByUserId?: string;
  lastModifiedDate?: string;
  lastModifiedBy?: string;
  lastModifiedByUserId?: string;
  state?: string;
}

export interface IonosShareProperties {
  editPrivilege: boolean;
  sharePrivilege: boolean;
}

export interface IonosShare {
  id: string;
  type: string;
  href: string;
  properties: IonosShareProperties;
}

export interface IonosShareListResponse {
  id: string;
  type: string;
  items: IonosShare[];
}

export interface IonosDatacenterProperties {
  name: string;
  description?: string;
  location: string;
  version?: number;
  cpuArchitecture?: Array<{ cpuFamily: string; maxCores: number; maxRam: number; vendor: string }>;
}

export interface IonosDatacenter {
  id: string;
  type: string;
  href: string;
  metadata?: IonosMetadata;
  properties: IonosDatacenterProperties;
}

export interface IonosDatacenterListResponse {
  id: string;
  type: string;
  items: IonosDatacenter[];
}

export interface IonosResource {
  id: string;
  type: string;
  href: string;
  metadata?: IonosMetadata;
  properties?: {
    name?: string;
    secAuthProtection?: boolean;
  };
}

export interface IonosResourceListResponse {
  id: string;
  type: string;
  items: IonosResource[];
}

export interface IonosResourceByTypeResponse {
  id: string;
  type: string;
  items: IonosResource[];
}

// JWT payload from IONOS token
export interface IonosJwtPayload {
  iss: string;
  iat: number;
  exp: number;
  client: string;
  identity: {
    isParent: boolean;
    privileges: string[];
    uuid: string;
    resellerId: number;
    regDomain: string;
    role: string;
    contractNumber: number;
  };
}

export interface IonosJwtHeader {
  typ: string;
  kid: string;
  alg: string;
}
