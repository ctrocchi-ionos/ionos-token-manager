import { cn, getExpiryStatus, expiryStatusColor, timeUntil, formatDate } from '@/lib/utils';

interface ExpiryBadgeProps {
  expiresAt: string;
  status: string;
  className?: string;
}

export default function ExpiryBadge({ expiresAt, status, className }: ExpiryBadgeProps) {
  if (status === 'revoked') {
    return (
      <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border', 'text-red-700 bg-red-100 border-red-200', className)}>
        Revoked
      </span>
    );
  }

  const expiryStatus = getExpiryStatus(expiresAt);
  const colors = expiryStatusColor(expiryStatus);

  return (
    <span
      className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border', colors, className)}
      title={`Expires: ${formatDate(expiresAt)}`}
    >
      {expiryStatus === 'expired' ? 'Expired' : `Expires ${timeUntil(expiresAt)}`}
    </span>
  );
}
