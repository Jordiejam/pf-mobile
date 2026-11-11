import { useLocalSearchParams } from 'expo-router';
import { dayLabel, Money, timeLabel } from '@/core';
import { useLive } from '@/platform/app';
import { Card, Empty, Row, Rows, Screen } from '@/ui/kit';

const LABELS: Record<string, string> = {
  amount_minor: 'Amount', account_name: 'Account', destination_name: 'To', category_name: 'Category', occurred_at: 'Date',
  note: 'Payee', description: 'Description', negative: 'Money back', kind: 'Type', source_amount_minor: 'Original amount',
  source_currency: 'Original currency',
};

function show(key: string, value: unknown, currency: string): string {
  if (value == null || value === '') return 'nothing';
  if (key.endsWith('_minor')) return Money.format(Number(value), currency);
  if (key === 'occurred_at') return `${dayLabel(new Date(String(value)))} ${timeLabel(new Date(String(value)))}`;
  if (key === 'negative') return value ? 'yes' : 'no';
  return String(value);
}

/** Every change made to one transaction, newest first, and how it was made. */
export default function HistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const events = useLive((ledger) => ledger.audit.history(id), [id]);
  if (events.length === 0) return <Screen><Empty icon="time-outline" title="No history" /></Screen>;
  return (
    <Screen>
      <Card>
        <Rows>
          {events.map((event) => {
            const currency = String(event.after?.currency ?? event.before?.currency ?? 'GBP');
            const changes = event.action === 'edited' && event.before && event.after
              ? Object.keys(LABELS)
                  .filter((key) => event.before![key] !== event.after![key])
                  // The original amount only differs from the amount for another currency.
                  .filter((key) => key !== 'source_amount_minor' || event.after!.source_currency !== event.after!.currency)
                  .map((key) => `${LABELS[key]}: ${show(key, event.before![key], currency)} → ${show(key, event.after![key], currency)}`)
                  .join('\n')
              : undefined;
            const when = new Date(event.occurred_at);
            const via = event.via === 'assistant' ? ' by the assistant, approved by you' : event.via === 'schedule' ? ' by a repeating entry' : '';
            return (
              <Row
                key={event.id}
                lines={12}
                title={`${event.action[0].toUpperCase()}${event.action.slice(1)}${via}`}
                subtitle={[`${dayLabel(when)} ${timeLabel(when)}`, changes].filter(Boolean).join('\n')}
              />
            );
          })}
        </Rows>
      </Card>
    </Screen>
  );
}
