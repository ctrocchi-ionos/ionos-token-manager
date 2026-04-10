import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listTokens, getTokenStats, bulkDeleteTokens, revokeToken, dismissToken } from '@/api/client';
import ExpiryBadge from '@/components/ExpiryBadge';
import ConfirmDialog from '@/components/ConfirmDialog';
import { getEnabledPermissionLabels, countEnabledPermissions } from '@/lib/permissions';
import { cn, statusColor, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Plus,
  Search,
  Trash2,
  RefreshCw,
  Download,
  Shield,
  Clock,
  AlertTriangle,
  XCircle,
  X,
  Key,
} from 'lucide-react';

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'expiring_soon', label: 'Expiring Soon' },
  { key: 'expired', label: 'Expired' },
  { key: 'revoked', label: 'Revoked' },
];

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  const { data: statsResp } = useQuery({
    queryKey: ['tokenStats'],
    queryFn: () => getTokenStats(),
    refetchInterval: 30000,
  });

  const { data: tokensResp, isLoading } = useQuery({
    queryKey: ['tokens', statusFilter, search],
    queryFn: () => listTokens({ status: statusFilter, search: search || undefined }),
    refetchInterval: 30000,
  });

  const revokeMut = useMutation({
    mutationFn: revokeToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
      queryClient.invalidateQueries({ queryKey: ['tokenStats'] });
      toast.success('Token revoked');
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const dismissMut = useMutation({
    mutationFn: dismissToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
      queryClient.invalidateQueries({ queryKey: ['tokenStats'] });
      toast.success('Token removed from list');
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: () => bulkDeleteTokens('expired'),
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
      queryClient.invalidateQueries({ queryKey: ['tokenStats'] });
      toast.success(`Deleted ${resp.data?.deleted ?? 0} expired tokens`);
      setBulkDeleteConfirm(false);
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const stats = statsResp?.data;
  const tokens = tokensResp?.data ?? [];

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleExport = async (format: 'json' | 'csv') => {
    const resp = await fetch(`/api/tokens/export?format=${format}`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tokens.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Token Dashboard</h1>
        <Link
          to="/tokens/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Create Token
        </Link>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard icon={Key} label="Total" value={stats.total} color="text-gray-600" bg="bg-gray-50" />
          <StatCard icon={Shield} label="Active" value={stats.active} color="text-green-600" bg="bg-green-50" />
          <StatCard icon={AlertTriangle} label="Expiring Soon" value={stats.expiringSoon} color="text-yellow-600" bg="bg-yellow-50" />
          <StatCard icon={Clock} label="Expired" value={stats.expired} color="text-gray-500" bg="bg-gray-50" />
          <StatCard icon={XCircle} label="Revoked" value={stats.revoked} color="text-red-600" bg="bg-red-50" />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search tokens..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                statusFilter === f.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {stats && stats.expired > 0 && (
            <button
              onClick={() => setBulkDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete expired ({stats.expired})
            </button>
          )}
          <button
            onClick={() => handleExport('csv')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Token table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-500">Loading tokens...</span>
        </div>
      ) : tokens.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Key className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No tokens yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Create your first scoped API token to get started.
          </p>
          <Link
            to="/tokens/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Create Token
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Permissions</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Expiry</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Created</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tokens.map((token) => {
                const permLabels = getEnabledPermissionLabels(token.permissions);
                const permCount = countEnabledPermissions(token.permissions);

                return (
                  <tr key={token.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/tokens/${token.id}`} className="font-medium text-blue-600 hover:underline">
                        {token.name}
                      </Link>
                      {token.description && (
                        <p className="text-xs text-gray-400 truncate max-w-[200px]">{token.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {permLabels.slice(0, 3).map((label) => (
                          <span key={label} className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                            {label}
                          </span>
                        ))}
                        {permCount > 3 && (
                          <span className="inline-block px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">
                            +{permCount - 3} more
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-block px-2 py-0.5 rounded text-xs font-medium capitalize', statusColor(token.status))}>
                        {token.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ExpiryBadge expiresAt={token.expiresAt} status={token.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {formatDate(token.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {token.status !== 'revoked' && token.status !== 'expired' ? (
                        <button
                          onClick={() => setDeleteTarget(token.id)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Revoke token"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => dismissMut.mutate(token.id)}
                          className="text-gray-400 hover:text-gray-600 p-1"
                          title="Remove from list"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Revoke Token"
        message="This will delete the API token and clean up the associated sub-user and group in IONOS. This action cannot be undone."
        confirmLabel="Revoke"
        confirmVariant="danger"
        onConfirm={() => deleteTarget && revokeMut.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={bulkDeleteConfirm}
        title="Delete All Expired Tokens"
        message={`This will revoke and clean up all ${stats?.expired ?? 0} expired tokens and their associated IONOS sub-users and groups.`}
        confirmLabel="Delete All Expired"
        confirmVariant="danger"
        onConfirm={() => bulkDeleteMut.mutate()}
        onCancel={() => setBulkDeleteConfirm(false)}
      />
    </div>
  );
}

function StatCard({
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
