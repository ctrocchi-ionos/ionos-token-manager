import { useQuery } from '@tanstack/react-query';
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
import { checkNeedsSetup } from '@/api/client';

export default function App() {
  const { data, isLoading } = useQuery({
    queryKey: ['needs-setup'],
    queryFn: checkNeedsSetup,
    staleTime: Infinity,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (data?.data?.needsSetup) {
    return <Setup />;
  }

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
