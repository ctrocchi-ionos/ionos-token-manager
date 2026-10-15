import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addDcdAccount } from '@/api/client';
import { Shield, AlertTriangle, Loader2, ExternalLink } from 'lucide-react';

export default function Setup() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    const trimmed = token.trim();
    if (!trimmed) return;

    setError('');
    setIsSubmitting(true);
    try {
      await addDcdAccount(label.trim(), trimmed);
      // Invalidate so App.tsx re-checks and exits the setup screen
      await queryClient.invalidateQueries({ queryKey: ['dcd-accounts'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-8 w-full max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-blue-50 rounded-lg">
            <Shield className="w-7 h-7 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">IONOS Token Manager</h1>
            <p className="text-sm text-gray-500">Add your first DCD account</p>
          </div>
        </div>

        <p className="text-gray-600 mb-6 text-sm leading-relaxed">
          Connect an IONOS DCD account by pasting an admin API token for it. You can add more
          accounts later in Settings. Your accounts and tokens are private to you.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Account name</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={60}
              placeholder="e.g. Production (optional)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-300"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              IONOS API Token
            </label>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
              }}
              placeholder="eyJ0eXAiOiJKV1QiLCJhbGci..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-gray-900 placeholder:text-gray-300"
              rows={5}
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-1">
              Get your token from{' '}
              <a
                href="https://dcd.ionos.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline inline-flex items-center gap-0.5"
              >
                DCD <ExternalLink className="w-3 h-3" />
              </a>
              {' '}→ Profile → Token Manager
            </p>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!token.trim() || isSubmitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Save & Continue
          </button>
        </div>

        <p className="text-xs text-gray-400 mt-5 leading-relaxed">
          The token is encrypted with a key unique to your workspace before it is stored. Nobody
          else using this app can see it.
        </p>
      </div>
    </div>
  );
}
