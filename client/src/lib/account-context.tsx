import { createContext, useContext, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listDcdAccounts, setCurrentAccountId, type DcdAccount } from '@/api/client';

const STORAGE_KEY = 'tm.selectedDcdAccount';
// Queries that do not depend on the selected account survive a switch.
const KEEP_ON_SWITCH = new Set(['me', 'dcd-accounts', 'templates', 'audit']);

interface AccountContextValue {
  accounts: DcdAccount[];
  current: DcdAccount | null;
  select: (id: string) => void;
  isLoading: boolean;
  error: Error | null;
}

const AccountContext = createContext<AccountContextValue | null>(null);

function readStored(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function writeStored(id: string): void {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode: selection just isn't remembered */ }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate(); // App is rendered inside <BrowserRouter> (main.tsx)
  const { data, isLoading, error } = useQuery({
    queryKey: ['dcd-accounts'],
    queryFn: () => listDcdAccounts(),
    refetchInterval: 60_000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(readStored);
  const accounts = data?.data ?? [];
  const current = accounts.find((a) => a.id === selectedId) ?? accounts[0] ?? null;

  // The API client reads this when building headers. Children only render (and fetch) after this line ran.
  setCurrentAccountId(current?.id ?? null);

  function select(id: string) {
    if (id === current?.id) return;
    writeStored(id);
    setCurrentAccountId(id);
    setSelectedId(id);
    queryClient.resetQueries({ predicate: (query) => !KEEP_ON_SWITCH.has(String(query.queryKey[0])) });
    // Leave pages holding state of the previous account (half-filled Create Token, a token's detail page)
    navigate('/');
  }

  return (
    // A failed background refresh keeps the last good list; only a failed first load is an error
    <AccountContext.Provider value={{ accounts, current, select, isLoading, error: data ? null : ((error as Error | null) ?? null) }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccounts(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccounts must be used inside <AccountProvider>');
  return ctx;
}
