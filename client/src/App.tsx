import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CreateToken from './pages/CreateToken';
import TokenDetail from './pages/TokenDetail';
import Templates from './pages/Templates';
import AuditLog from './pages/AuditLog';
import Account from './pages/Account';
import Settings from './pages/Settings';
import Setup from './pages/Setup';
import { AccountProvider, useAccounts } from '@/lib/account-context';

function AppRoutes() {
  const { accounts, isLoading, error } = useAccounts();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white border border-red-200 text-red-700 rounded-xl p-6 max-w-md text-sm">{error.message}</div>
      </div>
    );
  }

  if (accounts.length === 0) return <Setup />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tokens/new" element={<CreateToken />} />
        <Route path="/tokens/:id" element={<TokenDetail />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="/account" element={<Account />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AccountProvider>
      <AppRoutes />
    </AccountProvider>
  );
}
