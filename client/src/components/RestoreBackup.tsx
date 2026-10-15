import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Upload } from 'lucide-react';
import { restoreMyBackup, type RestoreResult } from '@/api/client';
import ConfirmDialog from '@/components/ConfirmDialog';

const fileCls = 'block text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:text-sm file:bg-white hover:file:bg-gray-50 cursor-pointer';

function restoredMessage(r: RestoreResult | undefined): string {
  const base = `Restored ${r?.accounts ?? 0} DCD account(s) and ${r?.tokens ?? 0} token(s)`;
  if (!r?.skipped) return base;
  return `${base}. ${r.skipped} token(s) in the backup could not be imported; their IONOS users are not managed by this app.`;
}

/**
 * "Restore from my database + my key". Used in Settings and on the first-run screen (a user with no DCD account
 * yet, e.g. on a fresh copy of the app). Afterwards every query is reset, so the account list reloads and the
 * first-run screen is left as soon as the restored accounts arrive.
 */
export default function RestoreBackup({ title = 'Restore' }: { title?: string }) {
  const queryClient = useQueryClient();
  const dbRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function restore() {
    const dbFile = dbRef.current?.files?.[0];
    const keyFile = keyRef.current?.files?.[0];
    if (!dbFile || !keyFile) { toast.error('Select both your database file and your key file'); return; }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await dbFile.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const r = await restoreMyBackup(btoa(binary), (await keyFile.text()).trim());
      if (dbRef.current) dbRef.current.value = '';
      if (keyRef.current) keyRef.current.value = '';
      if (r.data?.skipped) toast.warning(restoredMessage(r.data));
      else toast.success(restoredMessage(r.data));
      await queryClient.resetQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-600">My database (.db)</label>
        <input ref={dbRef} type="file" accept=".db" className={fileCls} />
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-600">My key (.key)</label>
        <input ref={keyRef} type="file" accept=".key,text/plain" className={fileCls} />
      </div>
      <button
        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
        disabled={busy}
        onClick={() => setConfirm(true)}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}Restore
      </button>
      <ConfirmDialog
        open={confirm}
        title="Replace your data with this backup?"
        message="Your current DCD accounts, tokens, custom templates and history in this app are replaced by the backup. Other users are not affected. If you created tokens after this backup and they are still active in IONOS, the restore is refused until you revoke them."
        confirmLabel="Restore"
        confirmVariant="danger"
        onConfirm={() => { setConfirm(false); restore(); }}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
