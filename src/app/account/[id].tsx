import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { dayLabel, fromDayKey, Money } from '@/core';
import { useLedger, useLive } from '@/platform/app';
import { DateSheet } from '@/ui/datepicker';
import { EntryFeed } from '@/ui/entries';
import { Fab } from '@/ui/fab';
import { Amount, attempt, Button, Card, Choice, confirm, Field, IconButton, Notice, Row, Rows, Sheet, T } from '@/ui/kit';
import { PeriodBar, usePeriod } from '@/ui/period';
import { useColors } from '@/ui/theme';

export default function AccountScreen() {
  const c = useColors();
  const ledger = useLedger();
  const { id } = useLocalSearchParams<{ id: string }>();
  const period = usePeriod();
  const [sheet, setSheet] = useState<'correct' | 'valuation' | 'valuations' | 'date' | null>(null);
  const [amount, setAmount] = useState('');
  const [valuedAt, setValuedAt] = useState(() => new Date());
  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null);

  const data = useLive(
    (live) => {
      const account = live.accounts.get(id);
      return {
        account,
        statement: live.cards.statement(account),
        valuations: account.account_type === 'valued' ? live.valuations.list(id).reverse() : [],
        payer: account.payment_account_id ? live.accounts.find(account.payment_account_id).name : null,
      };
    },
    [id],
  );
  const { account, statement } = data;
  const valued = account.account_type === 'valued';
  const latest = data.valuations[0];

  const openValuation = (valuation?: (typeof data.valuations)[number]) => {
    setEditing(valuation ? { id: valuation.id, version: valuation.version } : null);
    setAmount(valuation ? Money.plain(valuation.amount_minor) : '');
    setValuedAt(valuation ? new Date(valuation.valued_at) : new Date());
    setSheet('valuation');
  };

  const saveValuation = () => {
    const minor = Money.parse(amount);
    const ok = attempt(() => {
      if (minor === null) throw new Error('Enter what the account is worth');
      if (editing) ledger.valuations.edit(editing.id, editing.version, minor, valuedAt.toISOString());
      else ledger.valuations.create(id, minor, valuedAt.toISOString());
    });
    if (ok) setSheet(null);
  };

  const header = (
    <View style={{ padding: 16, paddingBottom: 0, gap: 12 }}>
      {!!account.archived && <Notice>This account is archived. Its history stays, but it is hidden from lists and new entries.</Notice>}
      <Card style={{ padding: 16, gap: 12 }}>
        <View>
          <T variant="label">{valued ? 'Value' : account.account_type === 'credit_card' ? 'Balance' : 'Balance'}</T>
          <Amount size={32} weight="700" color={account.balance < 0 ? c.expense : c.text}>{Money.format(account.balance, account.currency)}</Amount>
          {valued && latest && (
            <T variant="small" muted>
              Last valued {dayLabel(new Date(latest.valued_at))} at {Money.format(latest.amount_minor, account.currency)}
            </T>
          )}
          {valued && !latest && <T variant="small" muted>No valuations yet: add one whenever you check what this is worth.</T>}
        </View>
        {statement && (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 24 }}>
              <View>
                <T variant="small" muted>Payable</T>
                <Amount>{Money.format(statement.payable, account.currency)}</Amount>
              </View>
              <View>
                <T variant="small" muted>Outstanding</T>
                <Amount>{Money.format(statement.outstanding, account.currency)}</Amount>
              </View>
            </View>
            <T variant="small" muted>
              Payment due {dayLabel(fromDayKey(statement.payment_due_on))} · next statement {dayLabel(fromDayKey(statement.next_statement_on))}
            </T>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {statement && (
            <Button
              title={data.payer ? `Pay from ${data.payer}` : 'Pay'} small icon="card-outline"
              onPress={() => router.push({ pathname: '/entry', params: { pay_card: id } })}
            />
          )}
          {valued ? (
            <>
              <Button title="Add valuation" small icon="trending-up" onPress={() => openValuation()} />
              {data.valuations.length > 0 && <Button title="Valuations" small kind="secondary" onPress={() => setSheet('valuations')} />}
            </>
          ) : (
            <Button
              title="Correct balance" small kind="secondary" icon="construct-outline"
              onPress={() => {
                setAmount(Money.plain(account.balance));
                setSheet('correct');
              }}
            />
          )}
        </View>
      </Card>
      <PeriodBar state={period} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen
        options={{
          title: account.name,
          headerRight: () => <IconButton icon="create-outline" label="Edit account" onPress={() => router.push({ pathname: '/account/edit', params: { id } })} size={22} />,
        }}
      />
      <EntryFeed filter={{ ...period.range, account_ids: [id] }} viewedAccountId={id} header={header} emptyHint="No transactions on this account in this period." />
      {!account.archived && <Fab accountId={id} />}

      <Sheet visible={sheet === 'correct'} onClose={() => setSheet(null)} title="Correct balance">
        <T muted>Enter what the account really holds. The difference is recorded as a balance correction you can see, edit or delete.</T>
        <Field label={`Actual balance (${account.currency})`} value={amount} onChangeText={setAmount} keyboardType="numbers-and-punctuation" autoFocus />
        <Button
          title="Correct"
          onPress={() => {
            const target = Money.parse(amount);
            const ok = attempt(() => {
              if (target === null) throw new Error('Enter the actual balance');
              ledger.entries.correctBalance(id, target, account.version);
            });
            if (ok) setSheet(null);
          }}
        />
      </Sheet>

      <Sheet visible={sheet === 'valuation'} onClose={() => setSheet(null)} title={editing ? 'Edit valuation' : 'Add valuation'}>
        <Field label={`Worth (${account.currency})`} value={amount} onChangeText={setAmount} keyboardType="numbers-and-punctuation" autoFocus />
        <Choice label="As of" value={dayLabel(valuedAt)} onPress={() => setSheet('date')} icon="calendar-outline" />
        <T variant="small" muted>A valuation is not income or spending: it just says what this was worth on that day.</T>
        <Button title="Save" onPress={saveValuation} />
        {editing && (
          <Button
            title="Delete valuation" kind="danger"
            onPress={() => confirm('Delete this valuation?', 'The account goes back to its earlier value plus later entries.', 'Delete', () => {
              if (attempt(() => ledger.valuations.delete(editing.id, editing.version))) setSheet(null);
            })}
          />
        )}
      </Sheet>
      <DateSheet visible={sheet === 'date'} onClose={() => setSheet('valuation')} value={valuedAt} onChange={setValuedAt} title="As of" />

      <Sheet visible={sheet === 'valuations'} onClose={() => setSheet(null)} title="Valuations">
        <Card>
          <Rows>
            {data.valuations.map((valuation) => (
              <Row
                key={valuation.id}
                title={Money.format(valuation.amount_minor, account.currency)}
                subtitle={`${dayLabel(new Date(valuation.valued_at))} · ${Money.format(valuation.change_minor, account.currency, { sign: true })} not from money moved`}
                onPress={() => openValuation(valuation)}
              />
            ))}
          </Rows>
        </Card>
      </Sheet>
    </View>
  );
}
