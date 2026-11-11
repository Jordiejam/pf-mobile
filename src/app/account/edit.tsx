import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { CURRENCIES, Money, type AccountType } from '@/core';
import { useLedger, useLive } from '@/platform/app';
import { attempt, Button, Card, Choice, confirm, Field, IconButton, PickerSheet, Screen, Segmented, T, Toggle } from '@/ui/kit';

const TYPES: { value: AccountType; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'valued', label: 'Valued' },
];

const TYPE_HINTS: Record<AccountType, string> = {
  standard: 'A balance that changes only when money moves: current accounts, savings, cash, prepaid cards.',
  credit_card: 'Tracks what you owe, split into the statement now payable and newer spending.',
  valued: 'Something whose worth changes on its own: a pension, investments, property, a loan. You record its value from time to time.',
};

export default function AccountEditScreen() {
  const ledger = useLedger();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [existing] = useState(() => (id ? ledger.accounts.find(id) : null));
  const groups = useLive((live) => live.accounts.groups());
  const payers = useLive((live) => live.accounts.list().filter((account) => account.account_type === 'standard' && account.id !== id));

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AccountType>(existing?.account_type ?? 'standard');
  const [groupId, setGroupId] = useState(existing?.group_id ?? groups[0]?.id ?? null);
  const [currency, setCurrency] = useState<string>(existing?.currency ?? ledger.settings.primaryCurrency);
  const [opening, setOpening] = useState(existing ? Money.plain(existing.opening_minor) : '');
  const [statementDay, setStatementDay] = useState(String(existing?.statement_day ?? ''));
  const [dueDay, setDueDay] = useState(String(existing?.due_day ?? ''));
  const [payerId, setPayerId] = useState<string | null>(existing?.payment_account_id ?? null);
  const [inNetWorth, setInNetWorth] = useState(existing ? !!existing.in_net_worth : true);
  const [sheet, setSheet] = useState<'group' | 'currency' | 'payer' | null>(null);

  const save = () => {
    const ok = attempt(() => {
      const openingMinor = opening.trim() ? Money.parse(opening) : 0;
      if (openingMinor === null) throw new Error('Enter a valid opening balance');
      if (!groupId) throw new Error('Choose a group');
      ledger.accounts.save(
        {
          name, group_id: groupId, account_type: type, currency, opening_minor: openingMinor, in_net_worth: inNetWorth,
          statement_day: Number(statementDay) || null, due_day: Number(dueDay) || null, payment_account_id: payerId,
        },
        existing ?? undefined,
      );
    });
    if (ok) router.back();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: existing ? 'Edit account' : 'New account',
          headerLeft: () => <IconButton icon="close" label="Close" onPress={() => router.back()} />,
        }}
      />
      <Screen>
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Current account" autoFocus={!existing} autoCapitalize="words" />
        <Segmented options={TYPES} value={type} onChange={setType} />
        <T variant="small" muted>{TYPE_HINTS[type]}</T>
        <Choice label="Group" value={groups.find((group) => group.id === groupId)?.name ?? null} onPress={() => setSheet('group')} />
        <Choice label="Currency" value={currency} onPress={() => setSheet('currency')} />
        <Field
          label={type === 'credit_card' ? 'Opening balance (negative if you owe)' : 'Opening balance'}
          value={opening} onChangeText={setOpening} keyboardType="numbers-and-punctuation" placeholder="0.00"
          hint="What it held before the first transaction you record here. It is not counted as income."
        />
        {type === 'credit_card' && (
          <>
            <Field label="Statement day of the month" value={statementDay} onChangeText={setStatementDay} keyboardType="number-pad" placeholder="1 to 31" />
            <Field label="Payment due day of the month" value={dueDay} onChangeText={setDueDay} keyboardType="number-pad" placeholder="1 to 31" />
            <Choice label="Usually paid from" value={payers.find((account) => account.id === payerId)?.name ?? null} placeholder="Optional" onPress={() => setSheet('payer')} />
          </>
        )}
        <Card>
          <Toggle title="Count in net worth" value={inNetWorth} onChange={setInNetWorth} />
        </Card>
        <Button title="Save" onPress={save} />
        {existing && (
          <>
            <Button
              title={existing.archived ? 'Unarchive' : 'Archive'} kind="secondary"
              onPress={() => attempt(() => ledger.accounts.setArchived(existing.id, !existing.archived)) && router.back()}
            />
            <Button
              title="Delete account" kind="danger"
              onPress={() => confirm('Delete this account?', 'Only an account with no history can be deleted.', 'Delete', () => {
                if (attempt(() => ledger.accounts.delete(existing.id))) router.dismissTo('/');
              })}
            />
          </>
        )}
      </Screen>
      <PickerSheet visible={sheet === 'group'} onClose={() => setSheet(null)} title="Group" value={groupId} onPick={setGroupId} options={groups.map((group) => ({ value: group.id, label: group.name }))} />
      <PickerSheet visible={sheet === 'currency'} onClose={() => setSheet(null)} title="Currency" value={currency} onPick={setCurrency} options={CURRENCIES.map((code) => ({ value: code as string, label: code }))} />
      <PickerSheet
        visible={sheet === 'payer'} onClose={() => setSheet(null)} title="Usually paid from" value={payerId} onPick={setPayerId}
        options={[{ value: null, label: 'None' }, ...payers.filter((account) => account.currency === currency).map((account) => ({ value: account.id as string | null, label: account.name }))]}
      />
    </>
  );
}
