import { dayLabel, Money } from '@/core';
import { useLedger, useLive } from '@/platform/app';
import { attempt, Button, Card, confirm, Empty, Notice, Screen, T } from '@/ui/kit';
import { View } from 'react-native';

const EVERY = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } as const;

/** Entries recorded automatically on a calendar. Each one, once recorded, is an ordinary entry. */
export default function SchedulesScreen() {
  const ledger = useLedger();
  const data = useLive((live) => ({
    schedules: live.capture.schedules(),
    accounts: new Map(live.accounts.list({ archived: true }).map((account) => [account.id, account])),
  }));
  if (data.schedules.length === 0) {
    return (
      <Screen>
        <Empty icon="repeat-outline" title="No repeating entries" hint="While adding an entry, open More options and choose how often it repeats." />
      </Screen>
    );
  }
  return (
    <Screen>
      {data.schedules.map((schedule) => {
        const account = data.accounts.get(schedule.template.account_id ?? '');
        return (
          <Card key={schedule.id} style={{ padding: 16, gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T variant="heading">{schedule.name}</T>
              <T>{schedule.template.amount_minor && account ? Money.format(schedule.template.amount_minor, schedule.template.currency ?? account.currency) : ''}</T>
            </View>
            <T variant="small" muted>
              Every {schedule.every > 1 ? `${schedule.every} ${EVERY[schedule.frequency]}s` : EVERY[schedule.frequency]} · {account?.name ?? 'Unknown account'}
              {'\n'}
              {schedule.active && schedule.next_due_at ? `Next on ${dayLabel(new Date(schedule.next_due_at))}` : schedule.next_due_at ? 'Paused' : 'Finished'}
              {schedule.next_index > 0 ? ` · recorded ${schedule.next_index} time${schedule.next_index > 1 ? 's' : ''}` : ''}
            </T>
            {schedule.error && <Notice>Paused: {schedule.error}. Fix that, then resume.</Notice>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {!!schedule.next_due_at && (
                <Button
                  title={schedule.active ? 'Pause' : 'Resume'} small kind="secondary"
                  onPress={() => attempt(() => {
                    ledger.capture.setScheduleActive(schedule.id, !schedule.active);
                    ledger.capture.runDue();
                  })}
                />
              )}
              <Button
                title="Delete" small kind="danger"
                onPress={() => confirm('Delete this repeating entry?', 'Entries it has already recorded stay in your ledger.', 'Delete', () => ledger.capture.deleteSchedule(schedule.id))}
              />
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
