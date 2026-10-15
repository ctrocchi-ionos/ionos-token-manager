import { Outlet, NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '@/api/client';
import { useAccounts } from '@/lib/account-context';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Plus,
  FileKey2,
  ScrollText,
  Settings,
  Shield,
  AlertTriangle,
  Users,
  CircleUser,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tokens/new', label: 'Create Token', icon: Plus },
  { to: '/templates', label: 'Templates', icon: FileKey2 },
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
  { to: '/account', label: 'IONOS Users', icon: Users },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout() {
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
    staleTime: Infinity,
  });

  const { accounts, current, select } = useAccounts();
  const adminDaysLeft = current?.hasToken ? current.daysRemaining : null;
  const adminWarning = !current?.hasToken || !!current?.expired || (adminDaysLeft !== null && adminDaysLeft < 7);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-gray-100 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-400" />
            <div>
              <h1 className="font-bold text-sm">IONOS Token Manager</h1>
              <p className="text-xs text-gray-400">Scoped API tokens</p>
            </div>
          </div>
          <label className="block mt-3 text-[11px] uppercase tracking-wide text-gray-400">DCD account</label>
          <select
            value={current?.id ?? ''}
            onChange={(e) => select(e.target.value)}
            className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-gray-100"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.label} · {a.contractNumber}</option>
            ))}
          </select>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white',
                )
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Sidebar footer: current user + admin token status */}
        <div className="p-3 border-t border-gray-700 space-y-2">
          {me?.data?.email && (
            <div className="flex items-center gap-2 text-xs text-gray-400 truncate">
              <CircleUser className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{me.data.email}</span>
            </div>
          )}
          {!current?.hasToken ? (
            <div className="flex items-center gap-2 text-xs text-yellow-400">
              <AlertTriangle className="w-4 h-4" />
              <span>{current?.label}: no API token</span>
            </div>
          ) : adminWarning ? (
            <div className="flex items-center gap-2 text-xs text-yellow-400">
              <AlertTriangle className="w-4 h-4" />
              <span>{current?.expired ? 'API token expired' : `API token: ${adminDaysLeft}d left`}</span>
            </div>
          ) : (
            <div className="text-xs text-gray-500">API token: {adminDaysLeft}d remaining</div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50">
        <div className="max-w-7xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
