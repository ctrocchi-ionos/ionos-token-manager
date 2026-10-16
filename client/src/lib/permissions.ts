export const PERMISSION_GROUPS: Record<string, Record<string, string>> = {
  'Compute & Infrastructure': {
    createDataCenter: 'Create Data Centers',
    createSnapshot: 'Create Snapshots',
    reserveIp: 'Reserve IP Blocks',
    createPcc: 'Private Cross Connects',
    createInternetAccess: 'Create Internet Access',
    createFlowLog: 'Create Flow Logs',
    createNetworkSecurityGroups: 'Network Security Groups',
  },
  'Storage & Backup': {
    s3Privilege: 'S3 Object Storage',
    createBackupUnit: 'Create Backup Units',
    accessAndManageNetworkFileStorage: 'Network File Storage',
  },
  'Databases': {
    manageDBaaS: 'Database as a Service',
    manageDataplatform: 'Data Platform',
  },
  'Kubernetes & Containers': {
    createK8sCluster: 'Kubernetes Clusters',
    manageRegistry: 'Container Registry',
    accessAndManageKaas: 'KaaS (Managed K8s)',
  },
  'Networking Services': {
    accessAndManageDns: 'DNS Management',
    accessAndManageCdn: 'CDN',
    accessAndManageVpn: 'VPN',
    accessAndManageApiGateway: 'API Gateway',
  },
  'Observability & Security': {
    accessActivityLog: 'Activity Log',
    accessAndManageMonitoring: 'Monitoring',
    accessAndManageCertificates: 'Certificate Manager',
    accessAndManageLogging: 'Logging Service',
    accessAndManageIamResources: 'IAM Resources',
  },
  'AI & ML': {
    accessAndManageAiModelHub: 'AI Model Hub',
  },
};

export function getPermissionLabel(key: string): string {
  for (const group of Object.values(PERMISSION_GROUPS)) {
    if (key in group) return group[key];
  }
  return key;
}

export function getEnabledPermissionLabels(permissions: Record<string, boolean>): string[] {
  return Object.entries(permissions)
    .filter(([, v]) => v)
    .map(([k]) => getPermissionLabel(k));
}

export function countEnabledPermissions(permissions: Record<string, boolean>): number {
  return Object.values(permissions).filter(Boolean).length;
}
