import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, differenceInDays, format } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string): string {
  return format(new Date(date), 'MMM d, yyyy HH:mm');
}

export function timeUntil(date: string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function daysUntil(date: string): number {
  return differenceInDays(new Date(date), new Date());
}

export type ExpiryStatus = 'healthy' | 'warning' | 'critical' | 'expired';

export function getExpiryStatus(expiresAt: string): ExpiryStatus {
  const days = daysUntil(expiresAt);
  if (days < 0) return 'expired';
  if (days < 3) return 'critical';
  if (days < 7) return 'warning';
  return 'healthy';
}

export function expiryStatusColor(status: ExpiryStatus): string {
  switch (status) {
    case 'healthy': return 'text-green-600 bg-green-50 border-green-200';
    case 'warning': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    case 'critical': return 'text-red-600 bg-red-50 border-red-200';
    case 'expired': return 'text-gray-500 bg-gray-100 border-gray-200';
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case 'active': return 'text-green-700 bg-green-100';
    case 'expired': return 'text-gray-500 bg-gray-100';
    case 'revoked': return 'text-red-700 bg-red-100';
    case 'error': return 'text-orange-700 bg-orange-100';
    default: return 'text-gray-500 bg-gray-100';
  }
}

export function formatTtl(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export const TTL_PRESETS = [
  { label: '1 hour', value: 3600 },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
  { label: '30 days', value: 2592000 },
  { label: '90 days', value: 7776000 },
  { label: '365 days', value: 31536000 },
];
