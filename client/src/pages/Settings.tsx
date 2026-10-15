import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Download, Info, Key, Loader2, Pencil, Plus, Save, Server, Trash2 } from 'lucide-react';
import {
  addDcdAccount, apiFetch, removeDcdAccount, renameDcdAccount, replaceDcdAccountToken, type DcdAccount,
} from '@/api/client';
import { useAccounts } from '@/lib/account-context';
import ConfirmDialog from '@/components/ConfirmDialog';
import RestoreBackup from '@/components/RestoreBackup';
import { cn, formatDate } from '@/lib/utils';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-300';
const tokenCls = `${inputCls} font-mono text-xs resize-none`;
const btn = 'flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700';
const primary = 'flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium';

function AccountCard({ account }: { account: DcdAccount }) {
  const queryClient = useQueryClient();
  const { accounts, current, select } = useAccounts();
  const [mode, setMode] = useState<'view' | 'token' | 'rename'>('view');
  const [token, setToken] = useState('');
  const [label, setLabel] = useState(account.label);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const done = (msg: string) => {
    queryClient.invalidateQueries({ queryKey: ['dcd-accounts'] });
    toast.success(msg);
    setMode('view');
    setToken('');
  };
  const replaceMut = useMutation({ mutationFn: () => replaceDcdAccountToken(account.id, token), onSuccess: () => done('API token replaced'), onError: (e) => toast.error(e.message) });
  const renameMut = useMutation({ mutationFn: () => renameDcdAccount(account.id, label), onSuccess: () => done('Account renamed'), onError: (e) => toast.error(e.message) });
  const removeMut = useMutation({
    mutationFn: () => removeDcdAccount(account.id),
    onSuccess: async () => {
      toast.success('Account removed');
      // Removing the selected account: move to the next one through select(), which also resets
      // the account-scoped queries so nothing of the removed account lingers.
      const next = account.id === current?.id ? accounts.find((a) => a.id !== account.id) : undefined;
      if (next) {
        await queryClient.invalidateQueries({ queryKey: ['dcd-accounts'] });
        select(next.id);
      } else {
        queryClient.resetQueries();
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const days = account.daysRemaining;
  const state = !account.hasToken ? 'missing' : account.expired ? 'expired' : days <= 7 ? 'warning' : 'ok';

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-gray-900">{account.label}</div>
          <div className="text-xs text-gray-500">Contract {account.contractNumber} · {account.tokensHoldingAccess} token(s) with IONOS users</div>
        </div>
        <div className={cn(
          'flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md',
          state === 'ok' ? 'bg-green-50 text-green-700' : state === 'warning' ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700',
        )}>
          {state === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          {state === 'missing' ? 'No API token' : state === 'expired' ? 'Token expired' : `${days} days left`}
        </div>
      </div>
      {account.expiresAt && <div className="text-xs text-gray-500">Token expires {formatDate(account.expiresAt)}</div>}

      <div className="flex gap-2 flex-wrap">
        <button className={btn} onClick={() => setMode(mode === 'token' ? 'view' : 'token')}><Key className="w-4 h-4" />{account.hasToken ? 'Replace token' : 'Add token'}</button>
        <button className={btn} onClick={() => { setLabel(account.label); setMode(mode === 'rename' ? 'view' : 'rename'); }}><Pencil className="w-4 h-4" />Rename</button>
        <button className={cn(btn, 'text-red-700 border-red-200 hover:bg-red-50')} onClick={() => setConfirmRemove(true)}><Trash2 className="w-4 h-4" />Remove</button>
      </div>

      {mode === 'token' && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={4} placeholder="eyJ0eXAiOiJKV1QiLCJhbGci..." className={tokenCls} />
          <p className="text-xs text-gray-500">Must be a token for contract {account.contractNumber}.</p>
          <button className={primary} disabled={!token.trim() || replaceMut.isPending} onClick={() => replaceMut.mutate()}>
            {replaceMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save token
          </button>
        </div>
      )}

      {mode === 'rename' && (
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} className={inputCls} />
          <button className={primary} disabled={!label.trim() || renameMut.isPending} onClick={() => renameMut.mutate()}>Save</button>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove "${account.label}"?`}
        message="This removes the account and its token history from this app. It does not touch IONOS. Accounts whose tokens still have IONOS users cannot be removed: revoke those tokens first."
        confirmLabel="Remove account"
        confirmVariant="danger"
        onConfirm={() => { setConfirmRemove(false); removeMut.mutate(); }}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}

function AddAccount() {
  const queryClient = useQueryClient();
  const { select } = useAccounts();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [token, setToken] = useState('');
  const addMut = useMutation({
    mutationFn: () => addDcdAccount(label.trim(), token.trim()),
    onSuccess: async (resp) => {
      await queryClient.invalidateQueries({ queryKey: ['dcd-accounts'] });
      toast.success('DCD account added and selected');
      setOpen(false); setLabel(''); setToken('');
      if (resp.data) select(resp.data.id); // also navigates to the dashboard
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open) {
    return <button className={btn} onClick={() => setOpen(true)}><Plus className="w-4 h-4" />Add DCD account</button>;
  }
  return (
    <div className="border border-dashed border-gray-300 rounded-lg p-4 space-y-2">
      <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Account name (optional)" className={inputCls} />
      <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={4} placeholder="Admin API token (JWT)" className={tokenCls} />
      <div className="flex gap-2">
        <button className={primary} disabled={!token.trim() || addMut.isPending} onClick={() => addMut.mutate()}>
          {addMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Add account
        </button>
        <button className={btn} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

async function downloadFile(path: string, fallbackName: string) {
  const res = await apiFetch(path);
  if (!res.ok) { toast.error('Download failed'); return; }
  const blob = await res.blob();
  const name = res.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function BackupCard() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
      <h2 className="font-semibold text-gray-900">Backup &amp; restore</h2>
      <div className="space-y-2">
        <p className="text-sm text-gray-600">
          Download my database and my key. Together they restore your DCD accounts, tokens, templates and history on this or any other
          copy of the app. Keep them apart: together they give access to your saved IONOS tokens.
        </p>
        <div className="flex gap-3 flex-wrap">
          <button className={btn} onClick={() => downloadFile('/backup/db', 'tokenmanager-my-backup.db')}><Download className="w-4 h-4" />Download my database</button>
          <button className={cn(btn, 'border-yellow-300 bg-yellow-50 text-yellow-800 hover:bg-yellow-100')} onClick={() => downloadFile('/backup/key', 'tokenmanager-my-key.key')}><Key className="w-4 h-4" />Download my key</button>
        </div>
      </div>
      <div className="border-t border-gray-100" />
      <RestoreBackup />
    </div>
  );
}

export default function Settings() {
  const { accounts } = useAccounts();
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-gray-400" />
          <h2 className="font-semibold text-gray-900">DCD accounts</h2>
        </div>
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            IONOS does not allow tokens to be renewed via API. Before a token expires, generate a new one in the{' '}
            <strong>IONOS console</strong> and use <strong>Replace token</strong>. Your accounts are private to you.
          </span>
        </div>
        <div className="space-y-3">
          {accounts.map((a) => <AccountCard key={a.id} account={a} />)}
        </div>
        <AddAccount />
      </div>
      <BackupCard />
    </div>
  );
}
