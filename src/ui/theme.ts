import { useColorScheme } from 'react-native';
import { useLive } from '@/platform/app';

const light = {
  background: '#F4F5F7',
  card: '#FFFFFF',
  text: '#14171F',
  muted: '#6B7280',
  faint: '#9CA3AF',
  line: '#E5E7EB',
  accent: '#2563EB',
  accentSoft: '#E0EAFF',
  onAccent: '#FFFFFF',
  income: '#0F8A5F',
  expense: '#C2410C',
  danger: '#B91C1C',
  warn: '#92400E',
  warnSoft: '#FEF3C7',
};

const dark: typeof light = {
  background: '#0B0D12',
  card: '#171A21',
  text: '#F3F4F6',
  muted: '#9CA3AF',
  faint: '#6B7280',
  line: '#272B35',
  accent: '#6B9BFF',
  accentSoft: '#1D2A4A',
  onAccent: '#0B0D12',
  income: '#34D399',
  expense: '#FB923C',
  danger: '#F87171',
  warn: '#FCD34D',
  warnSoft: '#3A2F12',
};

export type Colors = typeof light;

/** Chart colours that stay distinguishable in both themes. */
export const SERIES = ['#2563EB', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16', '#F97316', '#64748B'];

export function useColors(): Colors {
  const system = useColorScheme();
  const choice = useLive((ledger) => ledger.settings.get('theme') ?? 'system');
  return (choice === 'system' ? system : choice) === 'dark' ? dark : light;
}

export function useIsDark(): boolean {
  return useColors() === dark;
}
