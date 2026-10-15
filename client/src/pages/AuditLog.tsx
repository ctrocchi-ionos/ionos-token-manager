import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listAuditLog, apiFetch } from '@/api/client';
import { useAccounts } from '@/lib/account-context';
import { cn, formatDate } from '@/lib/utils';
import { Download, ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react';

const ACTION_LABELS: Record<string, string> = {
  'token.create': 'Token Created',
  'token.revoke': 'Token Revoked',
  'token.regenerate': 'Token Regenerated',
  'template.create': 'Template Created',
  'template.delete': 'Template Deleted',
  'account.add': 'DCD Account Added',
  'account.token_replace': 'DCD Token Replaced',
  'account.rename': 'DCD Account Renamed',
  'account.remove': 'DCD Account Removed',
  'account.delete_external_user': 'External IONOS User Deleted',
  'token.dismiss': 'Token Dismissed',
  'token.auto_cleanup': 'Expired Token Cleaned Up',
  'template.update': 'Template Updated',
  'workspace.migrated': 'Workspace Created From Old Data',
  'workspace.backup': 'Backup Downloaded',
  'workspace.backup_key': 'Backup Key Downloaded',
  'workspace.restore': 'Backup Restored',
};

export default function AuditLog() {
  const { accounts } = useAccounts();
  const accountLabel = (id: string | null) => (id ? accounts.find((a) => a.id === id)?.label ?? 'removed account' : '-');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionFilter, setActionFilter] = useState<string>('');

  const { data: resp, isLoading } = useQuery({
    queryKey: ['audit', page, actionFilter],
    queryFn: () => listAuditLog({ page, limit: 30, action: actionFilter || undefined }),
  });

  const entries = resp?.data ?? [];
  const total = resp?.pagination?.total ?? 0;
  const totalPages = Math.ceil(total / 30);

  const handleExport = async (format: 'json' | 'csv') => {
    const res = await apiFetch(`/audit/export?format=${format}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('csv')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            onClick={() => handleExport('json')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            <Download className="w-3.5 h-3.5" />
            JSON
          </button>
        </div>
      </div>

      {/* Filter */}
      <div>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Log table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No audit entries found.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-8 px-3 py-3"></th>
                <th className="text-left px-3 py-3 font-medium text-gray-500">Action</th>
                <th className="text-left px-3 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-3 py-3 font-medium text-gray-500">Account</th>
                <th className="text-left px-3 py-3 font-medium text-gray-500">Entity</th>
                <th className="text-left px-3 py-3 font-medium text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((entry) => {
                const isExpanded = expandedId === entry.id;
                return (
                  <tr key={entry.id}>
                    <td colSpan={6} className="p-0">
                      <div
                        className="flex items-center px-3 py-3 cursor-pointer hover:bg-gray-50"
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      >
                        <div className="w-8">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                        <div className="flex-1 font-medium">
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </div>
                        <div className="w-24">
                          {entry.success ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-500" />
                          )}
                        </div>
                        <div className="w-40 text-gray-500 text-xs truncate">{accountLabel(entry.accountId)}</div>
                        <div className="w-32 text-gray-500 text-xs font-mono">
                          {entry.entityId?.slice(0, 8) ?? '-'}
                        </div>
                        <div className="w-40 text-gray-500 text-xs">
                          {formatDate(entry.createdAt)}
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="px-11 pb-3">
                          {entry.errorMessage && (
                            <div className="text-sm text-red-600 mb-2">
                              Error: {entry.errorMessage}
                            </div>
                          )}
                          {entry.details && (
                            <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-48">
                              {JSON.stringify(entry.details, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {totalPages} ({total} entries)</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
