import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdminTokenStatus, renewAdminToken, updateAdminTokenConfig } from '@/api/client';
import { cn, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import { RefreshCw, Shield, AlertTriangle, CheckCircle2, Loader2, Save } from 'lucide-react';

const TTL_OPTIONS = [
  { label: '7 days', value: 604800 },
  { label: '14 days', value: 1209600 },
  { label: '30 days', value: 2592000 },
  { label: '90 days', value: 7776000 },
  { label: '180 days', value: 15552000 },
  { label: '365 days', value: 31536000 },
];

const THRESHOLD_OPTIONS = [
  { label: '1 day before', value: 86400 },
  { label: '3 days before', value: 259200 },
  { label: '7 days before', value: 604800 },
  { label: '14 days before', value: 1209600 },
];

export default function Settings() {
  const queryClient = useQueryClient();

  const { data: resp, isLoading } = useQuery({
    queryKey: ['adminTokenStatus'],
    queryFn: () => getAdminTokenStatus(),
    refetchInterval: 60000,
  });

  const renewMut = useMutation({
    mutationFn: () => renewAdminToken(),
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ['adminTokenStatus'] });
      queryClient.invalidateQueries({ queryKey: ['health'] });
      if (resp.data?.renewed) {
        toast.success('Admin token renewed!');
      } else {
        toast.info(resp.data?.message ?? 'No renewal needed');
      }
    },
    onError: (err) => toast.error(`Renewal failed: ${err.message}`),
  });

  const status = resp?.data;

  const [ttl, setTtl] = useState<number | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [autoRenew, setAutoRenew] = useState<boolean | null>(null);
  const [dirty, setDirty] = useState(false);

  // Initialize form state from server data
  const effectiveTtl = ttl ?? status?.renewalTtlSeconds ?? 2592000;
  const effectiveThreshold = threshold ?? status?.renewalThresholdSeconds ?? 604800;
  const effectiveAutoRenew = autoRenew ?? status?.autoRenewEnabled ?? true;

  const configMut = useMutation({
    mutationFn: () => updateAdminTokenConfig({
      renewalTtlSeconds: effectiveTtl,
      renewalThresholdSeconds: effectiveThreshold,
      autoRenewEnabled: effectiveAutoRenew,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminTokenStatus'] });
      toast.success('Configuration saved');
      setDirty(false);
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

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Admin token status */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5 text-gray-400" />
          <h2 className="font-semibold text-gray-900">Admin Token Status</h2>
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
            <dt className="text-gray-500">Last Renewal</dt>
            <dd>{status?.lastRenewalAt ? formatDate(status.lastRenewalAt) : 'Never'}</dd>
          </div>
        </dl>

        {status?.lastRenewalError && (
          <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
            Last renewal error: {status.lastRenewalError}
          </div>
        )}

        <button
          onClick={() => renewMut.mutate()}
          disabled={renewMut.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
        >
          {renewMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Renew Now
        </button>
      </div>

      {/* Auto-renewal config */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Auto-Renewal Configuration</h2>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={effectiveAutoRenew}
            onChange={(e) => { setAutoRenew(e.target.checked); setDirty(true); }}
            className="rounded border-gray-300 text-blue-600"
          />
          <div>
            <span className="text-sm font-medium text-gray-900">Enable auto-renewal</span>
            <p className="text-xs text-gray-500">Automatically generate a new admin token before the current one expires</p>
          </div>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New token lifetime (TTL)</label>
            <select
              value={effectiveTtl}
              onChange={(e) => { setTtl(Number(e.target.value)); setDirty(true); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {TTL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Renew threshold</label>
            <select
              value={effectiveThreshold}
              onChange={(e) => { setThreshold(Number(e.target.value)); setDirty(true); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {THRESHOLD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">How early to renew before expiry</p>
          </div>
        </div>

        {dirty && (
          <button
            onClick={() => configMut.mutate()}
            disabled={configMut.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
          >
            {configMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Configuration
          </button>
        )}
      </div>
    </div>
  );
}
