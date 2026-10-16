import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getAccountUsers, deleteExternalUser } from '@/api/client';
import type { AccountUser } from '@/api/client';
import ConfirmDialog from '@/components/ConfirmDialog';
import { cn, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Users,
  Shield,
  Lock,
  Trash2,
  RefreshCw,
  Settings,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Key,
  Info,
} from 'lucide-react';

export default function Account() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<AccountUser | null>(null);

  const { data: resp, isLoading, isError, error } = useQuery({
    queryKey: ['accountUsers'],
    queryFn: () => getAccountUsers(),
    refetchInterval: 60000,
  });

  const deleteMut = useMutation({
    mutationFn: deleteExternalUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountUsers'] });
      toast.success('User deleted from IONOS');
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const data = resp?.data;
  const adminUser = data?.users.find((u) => u.category === 'admin');
  const managedUsers = data?.users.filter((u) => u.category === 'managed') ?? [];
  const externalUsers = data?.users.filter((u) => u.category === 'external') ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">IONOS Users</h1>
          {data && (
            <p className="text-sm text-gray-500 mt-1">Contract #{data.contractNumber}</p>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard icon={Users} label="Total Users" value={data.summary.total} color="text-gray-600" bg="bg-gray-50" />
          <SummaryCard icon={Shield} label="Admin" value={data.summary.admin} color="text-indigo-600" bg="bg-indigo-50" />
          <SummaryCard icon={CheckCircle2} label="Managed" value={data.summary.managed} color="text-green-600" bg="bg-green-50" />
          <SummaryCard icon={AlertTriangle} label="External" value={data.summary.external} color="text-amber-600" bg="bg-amber-50" />
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-500">Loading account users...</span>
        </div>
      ) : isError ? (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">Failed to load account data</p>
            <p className="text-xs mt-1 text-red-600">{error instanceof Error ? error.message : 'Unknown error'}</p>
            <p className="text-xs mt-1 text-red-500">If this keeps happening, check this DCD account's API token in Settings, or replace it.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Admin token card */}
          {adminUser && (
            <div className="bg-white rounded-xl border-2 border-indigo-200 overflow-hidden">
              <div className="bg-indigo-50 px-5 py-3 border-b border-indigo-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-indigo-600" />
                  <span className="text-sm font-semibold text-indigo-700">Contract Owner (Admin Token)</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Protected</span>
                </div>
              </div>
              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-sm">
                    <span className="text-gray-500">User: </span>
                    <span className="font-medium text-gray-900">{adminUser.firstname} {adminUser.lastname}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-gray-500">Email: </span>
                    <span className="text-gray-700">{adminUser.email}</span>
                  </div>
                </div>
                {adminUser.adminTokenStatus && (
                  <div className="space-y-2">
                    <div className="text-sm flex items-center gap-2">
                      <span className="text-gray-500">Token expires:</span>
                      <span className={cn(
                        'font-medium',
                        adminUser.adminTokenStatus.daysRemaining > 7 ? 'text-green-600' :
                        adminUser.adminTokenStatus.daysRemaining > 1 ? 'text-yellow-600' : 'text-red-600',
                      )}>
                        {adminUser.adminTokenStatus.daysRemaining} days remaining
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                <span className="text-xs text-gray-400">This token cannot be deleted here. Manage it in Settings.</span>
                <Link
                  to="/settings"
                  className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Manage in Settings
                </Link>
              </div>
            </div>
          )}

          {/* Managed users */}
          {managedUsers.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Managed Users ({managedUsers.length})
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">User</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Email</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Token</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {managedUsers.map((u) => (
                      <tr key={u.ionosUserId} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="inline-block px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">Managed</span>
                            <span className="text-gray-900">{u.firstname} {u.lastname}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                        <td className="px-4 py-3">
                          <Link to={`/tokens/${u.managedTokenId}`} className="text-blue-600 hover:underline font-medium">
                            {u.managedTokenName}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-block px-2 py-0.5 rounded text-xs font-medium capitalize',
                            u.managedTokenStatus === 'active' ? 'text-green-700 bg-green-100' :
                            u.managedTokenStatus === 'revoked' ? 'text-red-700 bg-red-100' :
                            'text-gray-500 bg-gray-100'
                          )}>
                            {u.managedTokenStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/tokens/${u.managedTokenId}`}
                            className="text-gray-400 hover:text-blue-600 p-1"
                            title="View token details"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* External users */}
          {externalUsers.length > 0 ? (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                External Users ({externalUsers.length})
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">User</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Email</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Active</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Created</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {externalUsers.map((u) => (
                      <tr key={u.ionosUserId} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="inline-block px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">External</span>
                            <span className="text-gray-900">{u.firstname} {u.lastname}</span>
                          </div>
                          {u.possiblyFormerManaged && (
                            <p className="text-xs text-amber-600 mt-0.5 ml-[4.5rem]">Likely created by Token Manager</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                        <td className="px-4 py-3">
                          {u.active ? (
                            <span className="text-green-600 text-xs">Yes</span>
                          ) : (
                            <span className="text-gray-400 text-xs">No</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {u.createdDate ? formatDate(u.createdDate) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {u.possiblyFormerManaged ? (
                            // The server refuses these: it may be a colleague's token user. Only DCD can remove it.
                            <span className="text-xs text-gray-400" title="Created by the Token Manager, possibly by a colleague. Its owner revokes it, or remove it in DCD.">
                              Remove in DCD
                            </span>
                          ) : (
                            <button
                              onClick={() => setDeleteTarget(u)}
                              className="text-red-500 hover:text-red-700 p-1"
                              title="Delete user from IONOS"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : data && data.summary.external === 0 && !data.orphanTokens.length && (
            <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
              <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No external users or orphan tokens found. Your account is clean.</p>
            </div>
          )}

          {/* Orphan tokens — view only */}
          {data && data.orphanTokens.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-600" />
                Orphan Tokens ({data.orphanTokens.length})
              </h2>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-3 flex gap-3 items-start">
                <Info className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800">
                  These tokens exist on your admin account but are not managed by this tool.
                  They cannot be deleted from here because the IONOS Auth API requires
                  username/password authentication for token deletion — Bearer tokens (which this
                  tool uses) are not allowed. To delete them, log in to the{' '}
                  <a
                    href="https://dcd.ionos.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline hover:text-amber-900"
                  >
                    IONOS DCD
                  </a>
                  {' '}and remove them under Token Management. Expired tokens will stop working
                  automatically and can be safely ignored.
                </p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Token ID</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Created</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Expires</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.orphanTokens.map((t) => (
                      <tr key={t.tokenId} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-gray-700">{t.tokenId}</span>
                        </td>
                        <td className="px-4 py-3">
                          {t.expired ? (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium text-gray-500 bg-gray-100">Expired</span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium text-green-700 bg-green-100">Active</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {t.createdDate ? formatDate(t.createdDate) : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {t.expirationDate ? formatDate(t.expirationDate) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete External User"
        message={deleteTarget
          ? `This will permanently delete "${deleteTarget.firstname} ${deleteTarget.lastname}" (${deleteTarget.email}) from your IONOS contract. This user was not created by Token Manager, so no local data will be affected. This action cannot be undone.`
          : ''
        }
        confirmLabel="Delete User"
        confirmVariant="danger"
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.ionosUserId)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
  bg,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className={cn('rounded-xl border border-gray-200 p-4', bg)}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn('w-4 h-4', color)} />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <span className={cn('text-2xl font-bold', color)}>{value}</span>
    </div>
  );
}
