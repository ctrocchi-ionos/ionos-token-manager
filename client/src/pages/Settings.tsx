import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdminTokenStatus, updateAdminToken } from '@/api/client';
import { cn, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import { Shield, AlertTriangle, CheckCircle2, Loader2, Save, Download, Upload, Key, Info } from 'lucide-react';

export default function Settings() {
  const queryClient = useQueryClient();

  const { data: resp, isLoading } = useQuery({
    queryKey: ['adminTokenStatus'],
    queryFn: () => getAdminTokenStatus(),
    refetchInterval: 60000,
  });

  const status = resp?.data;

  const dbFileRef = useRef<HTMLInputElement>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);

  const [newToken, setNewToken] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const tokenMut = useMutation({
    mutationFn: () => updateAdminToken(newToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminTokenStatus'] });
      toast.success('API token updated');
      setNewToken('');
      setShowReplace(false);
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  const daysLeft = status?.daysRemaining ?? 0;
  const isHealthy = daysLeft > 7;
  const isWarning = daysLeft <= 7 && daysLeft > 0;
  const isExpired = daysLeft <= 0;

  async function handleDownloadDb() {
    const res = await fetch('/api/admin/backup/db');
    if (!res.ok) { toast.error('DB backup failed'); return; }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const filename = cd.match(/filename="?([^"]+)"?/)?.[1] ?? 'tokenmanager-backup.db';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadKey() {
    const res = await fetch('/api/admin/backup/key');
    if (!res.ok) { toast.error('Key download failed'); return; }
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'encryption.key'; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRestore() {
    const dbFile = dbFileRef.current?.files?.[0];
    const keyFile = keyFileRef.current?.files?.[0];
    if (!dbFile) { toast.error('Select a database file first'); return; }

    setRestoring(true);
    try {
      const dbBuffer = await dbFile.arrayBuffer();
      const bytes = new Uint8Array(dbBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const dbBase64 = btoa(binary);
      const key = keyFile ? await keyFile.text() : undefined;

      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ db: dbBase64, key: key?.trim() }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? 'Restore failed');
      if (dbFileRef.current) dbFileRef.current.value = '';
      if (keyFileRef.current) keyFileRef.current.value = '';
      await queryClient.invalidateQueries();
      toast.success(json.data?.warning
        ? `Restored — ${json.data.warning}`
        : 'Database restored successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Admin token status */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5 text-gray-400" />
          <h2 className="font-semibold text-gray-900">Admin Token</h2>
        </div>

        <div className={cn(
          'flex items-center gap-3 p-4 rounded-lg border',
          isHealthy ? 'bg-green-50 border-green-200' :
          isWarning ? 'bg-yellow-50 border-yellow-200' :
          'bg-red-50 border-red-200',
        )}>
          {isHealthy ? (
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          ) : (
            <AlertTriangle className={cn('w-5 h-5', isWarning ? 'text-yellow-600' : 'text-red-600')} />
          )}
          <div>
            <div className={cn(
              'font-medium',
              isHealthy ? 'text-green-700' : isWarning ? 'text-yellow-700' : 'text-red-700',
            )}>
              {isExpired ? 'Admin token expired!' : `${daysLeft} days remaining`}
            </div>
            {status?.expiresAt && (
              <div className="text-xs text-gray-500">Expires: {formatDate(status.expiresAt)}</div>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-500">Token ID</dt>
            <dd className="font-mono text-xs">{status?.tokenId?.slice(0, 12) ?? 'N/A'}...</dd>
          </div>
          <div>
            <dt className="text-gray-500">Last Updated</dt>
            <dd>{status?.lastUpdatedAt ? formatDate(status.lastUpdatedAt) : 'Never'}</dd>
          </div>
        </dl>

        {/* How renewal works */}
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            IONOS does not allow tokens to be renewed via API — it requires web login.
            When this token is about to expire, generate a new one in the{' '}
            <strong>IONOS console</strong> and paste it here using <strong>Replace Token</strong>.
          </span>
        </div>

        {isWarning || isExpired ? (
          <div className="text-sm font-medium text-red-700">
            {isExpired
              ? 'This token has expired. Generate a new one in the IONOS console now.'
              : `Only ${daysLeft} day(s) left — replace this token soon.`}
          </div>
        ) : null}

        <div className="flex gap-2">
          <button
            onClick={() => { setShowReplace(v => !v); setNewToken(''); }}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700"
          >
            <Key className="w-4 h-4" />
            Replace Token
          </button>
        </div>

        {showReplace && (
          <div className="space-y-3 pt-3 border-t border-gray-100">
            <textarea
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              placeholder="eyJ0eXAiOiJKV1QiLCJhbGci..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-gray-900 placeholder:text-gray-300"
              rows={4}
            />
            <div className="flex gap-2">
              <button
                onClick={() => tokenMut.mutate()}
                disabled={!newToken.trim() || tokenMut.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {tokenMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Update Token
              </button>
              <button
                onClick={() => { setShowReplace(false); setNewToken(''); }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Backup & Restore */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
        <h2 className="font-semibold text-gray-900">Backup &amp; Restore</h2>

        {/* Download */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Download backup</p>
          <p className="text-xs text-gray-500">
            Download both files to fully back up this instance. You need both to restore on a new instance.
          </p>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={handleDownloadDb}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 font-medium"
            >
              <Download className="w-4 h-4" />
              Download database
            </button>
            <button
              onClick={handleDownloadKey}
              className="flex items-center gap-2 px-4 py-2 border border-yellow-300 bg-yellow-50 text-yellow-800 rounded-lg text-sm hover:bg-yellow-100 font-medium"
            >
              <Key className="w-4 h-4" />
              Download encryption key
            </button>
          </div>
        </div>

        <div className="border-t border-gray-100" />

        {/* Restore */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">Restore from backup</p>
          <div className={cn(
            'text-xs p-3 rounded-lg border flex items-start gap-2',
            'bg-amber-50 border-amber-200 text-amber-800',
          )}>
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Restoring overwrites the current database. The old database is kept as{' '}
              <code className="font-mono">tokenmanager.db.bak</code> in your data directory.
              If you are restoring from a different instance, upload the encryption key too.
            </span>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">
              Database file <span className="text-red-500">*</span>
            </label>
            <input
              ref={dbFileRef}
              type="file"
              accept=".db"
              className="block text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:text-sm file:bg-white hover:file:bg-gray-50 cursor-pointer"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">
              Encryption key{' '}
              <span className="text-gray-400 font-normal">(required when migrating from a different instance)</span>
            </label>
            <input
              ref={keyFileRef}
              type="file"
              accept=".key,text/plain"
              className="block text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:text-sm file:bg-white hover:file:bg-gray-50 cursor-pointer"
            />
          </div>

          <button
            onClick={handleRestore}
            disabled={restoring}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
          >
            {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}
