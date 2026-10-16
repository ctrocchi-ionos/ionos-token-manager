import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getToken, revokeToken, regenerateToken, type SharedResource } from '@/api/client';
import PermissionPicker from '@/components/PermissionPicker';
import ExpiryBadge from '@/components/ExpiryBadge';
import TokenReveal from '@/components/TokenReveal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { cn, statusColor, formatDate, formatTtl } from '@/lib/utils';
import { toast } from 'sonner';
import { ArrowLeft, RefreshCw, Trash2, Copy, Check, Loader2, Server } from 'lucide-react';

/** What was shared with the token when it was created (stored with the token; no IONOS call needed). */
function SharedResourceList({ resources }: { resources: SharedResource[] }) {
  return (
    <ul className="space-y-2">
      {resources.map((r) => (
        <li key={r.resourceId} className="flex items-center gap-3 border border-gray-200 rounded-lg p-3 text-sm">
          <Server className="w-4 h-4 text-gray-400" />
          <span className="font-medium">{r.name}</span>
          <span className="text-xs text-gray-400">{r.type}</span>
          <span className="ml-auto text-xs text-gray-500">
            {[r.editPrivilege && 'can edit', r.sharePrivilege && 'can share'].filter(Boolean).join(', ') || 'read only'}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function TokenDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const { data: resp, isLoading, error } = useQuery({
    queryKey: ['tokens', id],
    queryFn: () => getToken(id!),
    enabled: !!id,
  });

  const revokeMut = useMutation({
    mutationFn: () => revokeToken(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
      queryClient.invalidateQueries({ queryKey: ['tokenStats'] });
      toast.success('Token revoked');
      navigate('/');
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const regenMut = useMutation({
    mutationFn: () => regenerateToken(id!),
    onSuccess: (resp) => {
      setNewTokenValue(resp.data?.tokenValue ?? null);
      setRegenConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['tokens', id] });
      toast.success('Token regenerated');
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const token = resp?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !token) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Token not found.</p>
        <Link to="/" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const handleCopyId = async () => {
    await navigator.clipboard.writeText(token.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link to="/" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2">
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{token.name}</h1>
          {token.description && <p className="text-sm text-gray-500 mt-1">{token.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('px-2.5 py-1 rounded text-xs font-medium capitalize', statusColor(token.status))}>
            {token.status}
          </span>
          <ExpiryBadge expiresAt={token.expiresAt} status={token.status} />
        </div>
      </div>

      {/* Regenerated token display */}
      {newTokenValue && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="font-medium text-green-700 mb-3">New Token Generated</h3>
          <TokenReveal tokenValue={newTokenValue} />
        </div>
      )}

      {/* Details */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">
        <div>
          <h3 className="font-medium text-gray-900 mb-3">Details</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">Internal ID</dt>
              <dd className="font-mono text-xs flex items-center gap-1">
                {token.id.slice(0, 8)}...
                <button onClick={handleCopyId} className="text-gray-400 hover:text-gray-600" title="Copy full ID">
                  {copiedId ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Sub-User Email</dt>
              <dd className="font-mono text-xs">{token.subUserEmail}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Created</dt>
              <dd>{formatDate(token.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Expires</dt>
              <dd>{formatDate(token.expiresAt)}</dd>
            </div>
            {token.lastRegeneratedAt && (
              <div>
                <dt className="text-gray-500">Last Regenerated</dt>
                <dd>{formatDate(token.lastRegeneratedAt)}</dd>
              </div>
            )}
            <div>
              <dt className="text-gray-500">TTL</dt>
              <dd>{formatTtl(token.ttlSeconds)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">IONOS User ID</dt>
              <dd className="font-mono text-xs">{token.ionosUserId.slice(0, 8)}...</dd>
            </div>
          </dl>
        </div>

        <hr />

        <div>
          <h3 className="font-medium text-gray-900 mb-3">Permissions</h3>
          <PermissionPicker value={token.permissions} onChange={() => {}} readOnly />
        </div>

        {token.sharedResources.length > 0 && (
          <>
            <hr />
            <div>
              <h3 className="font-medium text-gray-900 mb-3">Shared Resources</h3>
              <SharedResourceList resources={token.sharedResources} />
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      {token.status !== 'revoked' && (
        <div className="flex gap-3">
          {!token.cleanedUpAt && ( // its IONOS user was removed: nothing left to regenerate
            <button
              onClick={() => setRegenConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Regenerate Token
            </button>
          )}
          <button
            onClick={() => setRevokeConfirm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" />
            Revoke Token
          </button>
        </div>
      )}

      <ConfirmDialog
        open={revokeConfirm}
        title="Revoke Token"
        message="This will permanently delete the API token and clean up the IONOS sub-user and group. This cannot be undone."
        confirmLabel="Revoke"
        confirmVariant="danger"
        onConfirm={() => revokeMut.mutate()}
        onCancel={() => setRevokeConfirm(false)}
      />

      <ConfirmDialog
        open={regenConfirm}
        title="Regenerate Token"
        message="This will generate a new API token for the same sub-user and delete the old one. Anything still using the old token will stop working immediately."
        confirmLabel="Regenerate"
        onConfirm={() => regenMut.mutate()}
        onCancel={() => setRegenConfirm(false)}
      />
    </div>
  );
}
