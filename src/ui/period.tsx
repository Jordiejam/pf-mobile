import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { periodFor, periodLabel, shiftPeriod, type Period, type PeriodLength } from '@/core';
import { useLive } from '@/platform/app';
import { Button, IconButton, Segmented, Sheet, T } from './kit';
import { useColors } from './theme';

export interface PeriodState {
  length: PeriodLength;
  period: Period | null;
  label: string;
  /** ISO bounds for ledger filters; both undefined for all time. */
  range: { start?: string; end?: string };
  shift(by: number): void;
  setLength(length: PeriodLength): void;
  today(): void;
}

/** The period a screen is looking at: a week, reporting month, year or all time. */
export function usePeriod(initial: PeriodLength = 'month'): PeriodState {
  const startDay = useLive((ledger) => ledger.settings.monthStartDay);
  const [length, setLength] = useState<PeriodLength>(initial);
  const [anchor, setAnchor] = useState(() => new Date());
  return useMemo(() => {
    const period = periodFor(length, anchor, startDay);
    return {
      length,
      period,
      label: periodLabel(length, period, startDay),
      range: period ? { start: period.start.toISOString(), end: period.end.toISOString() } : {},
      shift: (by) => period && setAnchor(shiftPeriod(length, period, by, startDay).start),
      setLength,
      today: () => setAnchor(new Date()),
    };
  }, [length, anchor, startDay]);
}

const LENGTHS: { value: PeriodLength; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All' },
];

/** Previous and next arrows around the period's name; the name opens the length choice. */
export function PeriodBar({ state }: { state: PeriodState }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const fixed = state.length === 'all';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: 12 }}>
      <IconButton icon="chevron-back" label="Previous period" onPress={() => state.shift(-1)} color={fixed ? c.line : c.accent} />
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Period: ${state.label}. Change`}
        style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <T variant="heading">{state.label}</T>
      </Pressable>
      <IconButton icon="chevron-forward" label="Next period" onPress={() => state.shift(1)} color={fixed ? c.line : c.accent} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Period">
        <Segmented options={LENGTHS} value={state.length} onChange={state.setLength} />
        <Button
          title="Back to today"
          kind="secondary"
          onPress={() => {
            state.today();
            setOpen(false);
          }}
        />
      </Sheet>
    </View>
  );
}
