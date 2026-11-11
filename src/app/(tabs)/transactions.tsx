import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Money, type EntryKind } from '@/core';
import { useLive } from '@/platform/app';
import { EntryFeed } from '@/ui/entries';
import { Fab } from '@/ui/fab';
import { Amount, Chip, ChipRow, IconButton, PickerSheet, T, type Option } from '@/ui/kit';
import { PeriodBar, usePeriod } from '@/ui/period';
import { useColors } from '@/ui/theme';

const KINDS: { value: EntryKind; label: string }[] = [
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfers' },
];

export default function TransactionsScreen() {
  const c = useColors();
  const period = usePeriod();
  const [searching, setSearching] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<EntryKind | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [picker, setPicker] = useState<'account' | 'category' | null>(null);

  const filter = {
    ...period.range,
    text: text || undefined,
    kinds: kind ? [kind] : undefined,
    account_ids: accountId ? [accountId] : undefined,
    category_ids: categoryId ? [categoryId] : undefined,
  };
  const filterKey = JSON.stringify(filter);
  const data = useLive(
    (ledger) => {
      const primary = ledger.settings.primaryCurrency;
      const categories = ledger.categories.list({ archived: true });
      return {
        primary,
        totals: ledger.entries.totals(filter, primary),
        accounts: ledger.accounts.list({ archived: true }),
        categories,
        categoryOptions: categories.map<Option<string>>((category, index) => ({
          value: category.id, label: category.name, indent: !!category.parent_id,
          heading: categories[index - 1]?.kind !== category.kind ? (category.kind === 'expense' ? 'Expenses' : 'Income') : undefined,
        })),
      };
    },
    [filterKey],
  );
  const account = data.accounts.find((item) => item.id === accountId);
  const category = data.categories.find((item) => item.id === categoryId);

  const header = (
    <View style={{ padding: 16, paddingBottom: 0, gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <PeriodBar state={period} />
        </View>
        <IconButton icon={searching ? 'close' : 'search'} label={searching ? 'Close search' : 'Search and filter'} onPress={() => {
          if (searching) {
            setText('');
            setKind(null);
            setAccountId(null);
            setCategoryId(null);
          }
          setSearching(!searching);
        }} />
      </View>
      {searching && (
        <>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Search payee or description"
            placeholderTextColor={c.faint}
            autoFocus
            accessibilityLabel="Search"
            style={{ backgroundColor: c.card, color: c.text, borderRadius: 12, paddingHorizontal: 14, minHeight: 44, fontSize: 16 }}
          />
          <ChipRow>
            {KINDS.map((option) => (
              <Chip key={option.value} label={option.label} selected={kind === option.value} onPress={() => setKind(kind === option.value ? null : option.value)} />
            ))}
            {account ? <Chip label={account.name} selected onRemove={() => setAccountId(null)} /> : <Chip label="Account" icon="add" onPress={() => setPicker('account')} />}
            {category ? <Chip label={category.name} selected onRemove={() => setCategoryId(null)} /> : <Chip label="Category" icon="add" onPress={() => setPicker('category')} />}
          </ChipRow>
        </>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <T variant="small" muted>Income</T>
          <Amount color={c.income}>{Money.format(data.totals.income, data.primary)}</Amount>
        </View>
        <View>
          <T variant="small" muted>Spending</T>
          <Amount>{Money.format(data.totals.expense, data.primary)}</Amount>
        </View>
        <View>
          <T variant="small" muted>Transfers</T>
          <Amount color={c.muted}>{Money.format(data.totals.transfer, data.primary)}</Amount>
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <EntryFeed filter={filter} header={header} emptyHint={searching ? 'No transactions match.' : 'No transactions in this period. Tap + to add one, or tell the assistant.'} />
      <Fab />
      <PickerSheet
        visible={picker === 'account'} onClose={() => setPicker(null)} title="Account" value={accountId} onPick={setAccountId}
        options={data.accounts.map((item) => ({ value: item.id, label: item.name, detail: item.archived ? 'Archived' : undefined }))}
      />
      <PickerSheet visible={picker === 'category'} onClose={() => setPicker(null)} title="Category" value={categoryId} onPick={setCategoryId} options={data.categoryOptions} />
    </View>
  );
}
