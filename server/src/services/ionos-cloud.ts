import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { config } from '../config.js';
import type {
  IonosUser,
  IonosUserListResponse,
  IonosGroup,
  IonosGroupListResponse,
  IonosGroupProperties,
  IonosDatacenter,
  IonosDatacenterListResponse,
  IonosResource,
  IonosResourceByTypeResponse,
  IonosShare,
  IonosShareListResponse,
} from '../types/ionos.js';
import type { PermissionFlags, SharedResource } from '../types/app.js';

const CLOUD_BASE = 'https://api.ionos.com/cloudapi/v6';

function createClient(): AxiosInstance {
  return axios.create({
    baseURL: CLOUD_BASE,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.getAdminToken()}`,
    },
  });
}

async function waitForCompletion(resp: AxiosResponse, timeoutMs = 60000): Promise<void> {
  if (resp.status === 200 || resp.status === 201) return;
  const location = resp.headers['location'];
  if (!location) return;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const statusResp = await axios.get(location, {
        headers: { Authorization: `Bearer ${config.getAdminToken()}` },
        timeout: 10000,
      });
      const state = statusResp.data?.metadata?.status;
      if (state === 'DONE') return;
      if (state === 'FAILED') {
        throw new Error(`IONOS operation failed: ${statusResp.data?.metadata?.message ?? 'unknown'}`);
      }
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        // Resource might not be trackable yet
      } else if (!(err instanceof Error && err.message.includes('IONOS operation failed'))) {
        // Swallow non-fatal polling errors
      } else {
        throw err;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('IONOS operation timed out');
}

// ── Users ──

export async function createUser(params: {
  firstname: string;
  lastname: string;
  email: string;
  password: string;
}): Promise<IonosUser> {
  const client = createClient();
  const resp = await client.post('/um/users', {
    properties: {
      firstname: params.firstname,
      lastname: params.lastname,
      email: params.email,
      password: params.password,
      administrator: false,
      active: true,
      forceSecAuth: false,
    },
  });
  await waitForCompletion(resp);
  return resp.data;
}

export async function listUsers(): Promise<IonosUser[]> {
  const client = createClient();
  const resp = await client.get<IonosUserListResponse>('/um/users?depth=1');
  return resp.data.items ?? [];
}

export async function getUser(userId: string): Promise<IonosUser> {
  const client = createClient();
  const resp = await client.get<IonosUser>(`/um/users/${userId}?depth=1`);
  return resp.data;
}

export async function deleteUser(userId: string): Promise<void> {
  const client = createClient();
  const resp = await client.delete(`/um/users/${userId}`);
  await waitForCompletion(resp);
}

// ── Groups ──

function permissionsToGroupProperties(name: string, permissions: PermissionFlags): IonosGroupProperties {
  return {
    name,
    createDataCenter: permissions.createDataCenter ?? false,
    createSnapshot: permissions.createSnapshot ?? false,
    reserveIp: permissions.reserveIp ?? false,
    accessActivityLog: permissions.accessActivityLog ?? false,
    createPcc: permissions.createPcc ?? false,
    s3Privilege: permissions.s3Privilege ?? false,
    createBackupUnit: permissions.createBackupUnit ?? false,
    createInternetAccess: permissions.createInternetAccess ?? false,
    createK8sCluster: permissions.createK8sCluster ?? false,
    createFlowLog: permissions.createFlowLog ?? false,
    accessAndManageMonitoring: permissions.accessAndManageMonitoring ?? false,
    accessAndManageCertificates: permissions.accessAndManageCertificates ?? false,
    accessAndManageLogging: permissions.accessAndManageLogging ?? false,
    manageDBaaS: permissions.manageDBaaS ?? false,
    accessAndManageDns: permissions.accessAndManageDns ?? false,
    manageRegistry: permissions.manageRegistry ?? false,
    accessAndManageCdn: permissions.accessAndManageCdn ?? false,
    accessAndManageVpn: permissions.accessAndManageVpn ?? false,
    accessAndManageApiGateway: permissions.accessAndManageApiGateway ?? false,
    accessAndManageKaas: permissions.accessAndManageKaas ?? false,
    accessAndManageNetworkFileStorage: permissions.accessAndManageNetworkFileStorage ?? false,
    accessAndManageAiModelHub: permissions.accessAndManageAiModelHub ?? false,
    createNetworkSecurityGroups: permissions.createNetworkSecurityGroups ?? false,
    accessAndManageIamResources: permissions.accessAndManageIamResources ?? false,
    manageDataplatform: permissions.manageDataplatform ?? false,
  };
}

export async function createGroup(name: string, permissions: PermissionFlags): Promise<IonosGroup> {
  const client = createClient();
  const resp = await client.post('/um/groups', {
    properties: permissionsToGroupProperties(name, permissions),
  });
  await waitForCompletion(resp);
  return resp.data;
}

export async function listGroups(): Promise<IonosGroup[]> {
  const client = createClient();
  const resp = await client.get<IonosGroupListResponse>('/um/groups?depth=1');
  return resp.data.items ?? [];
}

export async function deleteGroup(groupId: string): Promise<void> {
  const client = createClient();
  const resp = await client.delete(`/um/groups/${groupId}`);
  await waitForCompletion(resp);
}

export async function addUserToGroup(groupId: string, userId: string): Promise<void> {
  const client = createClient();
  const resp = await client.post(`/um/groups/${groupId}/users`, { id: userId });
  await waitForCompletion(resp);
}

// ── Resource Sharing ──

export async function shareResourceWithGroup(
  groupId: string,
  resourceId: string,
  editPrivilege: boolean,
  sharePrivilege: boolean,
): Promise<void> {
  const client = createClient();
  const resp = await client.post(`/um/groups/${groupId}/shares/${resourceId}`, {
    properties: { editPrivilege, sharePrivilege },
  });
  await waitForCompletion(resp);
}

export async function listGroupShares(groupId: string): Promise<IonosShare[]> {
  const client = createClient();
  const resp = await client.get<IonosShareListResponse>(`/um/groups/${groupId}/shares?depth=1`);
  return resp.data.items ?? [];
}

// ── Resources ──

export async function listDatacenters(): Promise<IonosDatacenter[]> {
  const client = createClient();
  const resp = await client.get<IonosDatacenterListResponse>('/datacenters?depth=1');
  return resp.data.items ?? [];
}

export async function listResourcesByType(type: string): Promise<IonosResource[]> {
  const client = createClient();
  const resp = await client.get<IonosResourceByTypeResponse>(`/um/resources/${type}?depth=1`);
  return resp.data.items ?? [];
}

export async function listAllResources(): Promise<IonosResource[]> {
  const client = createClient();
  const resp = await client.get<IonosResourceByTypeResponse>('/um/resources?depth=1');
  return resp.data.items ?? [];
}
