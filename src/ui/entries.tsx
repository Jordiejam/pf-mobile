import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { type ReactElement, useMemo, useState } from 'react';
import { Pressable, SectionList, View } from 'react-native';
import { dayKey, dayLabel, fromDayKey, Money, type Entry, type EntryFilter } from '@/core';
import { useLive } from '@/platform/app';
import { Amount, Button, Empty, T, type IconName } from './kit';
import { useColors, type Colors } from './theme';

/** An entry's amount as it affects the account being viewed (or its own account). */
export function signedAmount(entry: Entry, viewedAccountId?: string): number {
  if (entry.kind === 'transfer') {
    if (!viewedAccountId) return entry.amount_minor;
    return entry.destination_id === viewedAccountId ? entry.amount_minor : -entry.amount_minor;
  }
  const credits = (entry.kind === 'income') !== !!entry.negative;
  return credits ? entry.amount_minor : -entry.amount_minor;
}

export function entryTitle(entry: Entry): string {
  if (entry.kind === 'transfer') return entry.note || `${entry.account_name} → ${entry.destination_name}`;
  return entry.note || entry.category_name || entry.kind;
}

function entryIcon(entry: Entry, c: Colors): { name: IconName; color: string } {
  if (entry.kind === 'transfer') return { name: 'swap-horizontal', color: c.muted };
  if (entry.is_adjustment) return { name: 'construct-outline', color: c.muted };
  if (entry.negative) return { name: 'return-up-back', color: c.income };
  return entry.kind === 'income' ? { name: 'arrow-down-circle', color: c.income } : { name: 'arrow-up-circle', color: c.expense };
}

export function EntryRow({ entry, viewedAccountId }: { entry: Entry; viewedAccountId?: string }) {
  const c = useColors();
  const icon = entryIcon(entry, c);
  const amount = signedAmount(entry, viewedAccountId);
  const transfer = entry.kind === 'transfer';
  const details = transfer
    ? entry.note ? `${entry.account_name} → ${entry.destination_name}` : 'Transfer'
    : [entry.note ? entry.category_name : null, viewedAccountId ? null : entry.account_name].filter(Boolean).join(' · ');
  const foreign = entry.source_currency !== entry.currency;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/entry', params: { id: entry.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${entryTitle(entry)}, ${Money.format(amount, entry.currency)}`}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 52, paddingVertical: 6,
        backgroundColor: c.card, opacity: pressed ? 0.6 : 1,
      })}>
      <Ionicons name={icon.name} size={22} color={icon.color} />
      <View style={{ flex: 1 }}>
        <T numberOfLines={1}>{entryTitle(entry)}</T>
        {!!details && <T variant="small" muted numberOfLines={1}>{details}</T>}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Amount color={transfer && !viewedAccountId ? c.muted : amount > 0 ? c.income : c.text}>
          {Money.format(amount, entry.currency, { sign: !transfer || !!viewedAccountId })}
        </Amount>
        {foreign && <T variant="small" muted>{Money.format(entry.source_amount_minor, entry.source_currency)}</T>}
        {entry.refunded_minor > 0 && <T variant="small" color={c.income}>{Money.format(entry.refunded_minor, entry.currency)} back</T>}
      </View>
    </Pressable>
  );
}

const PAGE = 100;

/**
 * Entries matching a filter, grouped by day with each day's net change, loading more on
 * request. It is the page's scroll container; anything above the list goes in `header`.
 */
export function EntryFeed(props: { filter: EntryFilter; viewedAccountId?: string; header?: ReactElement; emptyHint?: string }) {
  const c = useColors();
  const [limit, setLimit] = useState(PAGE);
  const filterKey = JSON.stringify(props.filter);
  const entries = useLive((ledger) => ledger.entries.search({ ...props.filter, limit: limit + 1 }), [filterKey, limit]);
  const sections = useMemo(() => {
    const days = new Map<string, Entry[]>();
    for (const entry of entries.slice(0, limit)) {
      const key = dayKey(entry.occurred_at);
      days.set(key, [...(days.get(key) ?? []), entry]);
    }
    return [...days].map(([key, data]) => ({ key, data }));
  }, [entries, limit]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(entry) => entry.id}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 96 }}
      ListHeaderComponent={props.header}
      renderSectionHeader={({ section }) => {
        // A day's net change only means something within one currency.
        const currencies = new Set(section.data.map((entry) => entry.currency));
        const net = section.data.reduce(
          (sum, entry) => sum + (entry.kind === 'transfer' && !props.viewedAccountId ? 0 : signedAmount(entry, props.viewedAccountId)),
          0,
        );
        return (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 }}>
            <T variant="label">{dayLabel(fromDayKey(section.key))}</T>
            {currencies.size === 1 && <T variant="small" muted>{Money.format(net, section.data[0].currency, { sign: true })}</T>}
          </View>
        );
      }}
      renderItem={({ item }) => <EntryRow entry={item} viewedAccountId={props.viewedAccountId} />}
      ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: c.line, marginLeft: 50 }} />}
      ListEmptyComponent={<Empty icon="receipt-outline" title="Nothing here" hint={props.emptyHint ?? 'No transactions match.'} />}
      ListFooterComponent={
        entries.length > limit ? (
          <View style={{ padding: 16 }}>
            <Button title="Load more" kind="secondary" onPress={() => setLimit(limit + PAGE)} />
          </View>
        ) : undefined
      }
    />
  );
}
