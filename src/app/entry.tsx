import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import {
  CURRENCIES, dayKey, dayLabel, isCurrency, Money, timeLabel,
  type Currency, type Entry, type EntryInput, type EntryKind, type EntryTemplate, type Frequency, type Ledger,
} from '@/core';
import { useLedger, useLive } from '@/platform/app';
import { DateSheet } from '@/ui/datepicker';
import { entryTitle } from '@/ui/entries';
import {
  attempt, Button, Chip, ChipRow, Choice, confirm, Field, IconButton, Notice, PickerSheet, Row, Rows, Screen, Section,
  Segmented, Sheet, T, type Option,
} from '@/ui/kit';
import { useColors } from '@/ui/theme';

interface Draft {
  kind: EntryKind;
  amount: string;
  negative: boolean;
  currency: Currency | null;
  accountId: string | null;
  destinationId: string | null;
  categoryId: string | null;
  note: string;
  description: string;
  date: Date;
  rate: string;
  exact: string;
  refundOfId: string | null;
}

type Params = { id?: string; account_id?: string; refund_of?: string; pay_card?: string; bookmark?: string };

const KINDS: { value: EntryKind; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
];

const REPEATS: { value: Frequency | 'none'; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

function fromTemplate(draft: Draft, template: EntryTemplate): Draft {
  return {
    ...draft,
    kind: template.kind ?? draft.kind,
    amount: template.amount_minor ? Money.plain(template.amount_minor) : '',
    negative: !!template.negative,
    currency: isCurrency(template.currency) ? template.currency : null,
    accountId: template.account_id ?? draft.accountId,
    destinationId: template.destination_id ?? null,
    categoryId: template.category_id ?? null,
    note: template.note ?? '',
    description: template.description ?? '',
  };
}

/** Where a new or existing entry's form starts from. */
function initialDraft(ledger: Ledger, params: Params, existing: Entry | null): Draft {
  const blank: Draft = {
    kind: 'expense', amount: '', negative: false, currency: null, accountId: null, destinationId: null, categoryId: null,
    note: '', description: '', date: new Date(), rate: '', exact: '', refundOfId: null,
  };
  if (existing) {
    const foreign = existing.source_currency !== existing.currency;
    return {
      ...blank,
      kind: existing.kind,
      amount: Money.plain(existing.source_amount_minor),
      negative: !!existing.negative,
      currency: foreign ? existing.source_currency : null,
      accountId: existing.account_id,
      destinationId: existing.destination_id,
      categoryId: existing.category_id,
      note: existing.note,
      description: existing.description,
      date: new Date(existing.occurred_at),
      refundOfId: existing.refund_of_id,
    };
  }
  if (params.refund_of) {
    const purchase = ledger.entries.find(params.refund_of);
    return {
      ...blank, negative: true, refundOfId: purchase.id, accountId: purchase.account_id, categoryId: purchase.category_id,
      note: purchase.note, amount: Money.plain(Math.max(purchase.amount_minor - purchase.refunded_minor, 0)),
    };
  }
  if (params.pay_card) {
    const card = ledger.accounts.get(params.pay_card);
    const statement = ledger.cards.statement(card);
    return {
      ...blank, kind: 'transfer', accountId: card.payment_account_id, destinationId: card.id,
      amount: statement?.payable ? Money.plain(statement.payable) : '',
    };
  }
  if (params.bookmark) {
    const bookmark = ledger.capture.bookmarks().find((item) => item.id === params.bookmark);
    if (bookmark) return fromTemplate(blank, bookmark.template);
  }
  const active = ledger.accounts.list();
  const remembered = ledger.settings.get('last_account');
  const accountId = params.account_id ?? (active.some((account) => account.id === remembered) ? remembered! : active[0]?.id ?? null);
  return { ...blank, accountId };
}

function Editor({ params }: { params: Params }) {
  const c = useColors();
  const ledger = useLedger();
  const [existing] = useState(() => (params.id ? ledger.entries.find(params.id) : null));
  const [draft, setDraft] = useState(() => initialDraft(ledger, params, existing));
  const [repeat, setRepeat] = useState<Frequency | 'none'>('none');
  const [more, setMore] = useState(!!existing?.description);
  const [sheet, setSheet] = useState<'account' | 'destination' | 'category' | 'currency' | 'date' | 'bookmarks' | 'bookmark-name' | null>(null);
  const [bookmarkName, setBookmarkName] = useState('');
  const set = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));

  const data = useLive(
    (live) => {
      const accounts = live.accounts.list({ archived: true });
      const groups = new Map(live.accounts.groups().map((group) => [group.id, group.name]));
      const kind = draft.kind === 'transfer' ? null : draft.kind;
      const categories = kind ? live.categories.list({ kind }) : [];
      const recent = kind ? live.entries.recentCategoryIds(kind) : [];
      return {
        accounts,
        accountOptions: accounts
          .filter((account) => !account.archived || account.id === existing?.account_id || account.id === existing?.destination_id)
          .map<Option<string>>((account, index, list) => ({
            value: account.id, label: account.name, detail: Money.format(account.balance, account.currency),
            heading: list[index - 1]?.group_id !== account.group_id ? groups.get(account.group_id) : undefined,
          })),
        categories,
        categoryOptions: categories.map<Option<string>>((category) => ({ value: category.id, label: category.name, indent: !!category.parent_id })),
        quick: [...recent, ...categories.filter((category) => !category.parent_id).map((category) => category.id)]
          .filter((id, index, list) => list.indexOf(id) === index)
          .slice(0, 6),
        bookmarks: live.capture.bookmarks(),
        refunds: existing ? live.entries.refundsOf(existing.id) : [],
        purchase: draft.refundOfId ? live.entries.find(draft.refundOfId) : null,
      };
    },
    [draft.kind, draft.refundOfId, existing?.id],
  );

  const account = data.accounts.find((item) => item.id === draft.accountId);
  const destination = data.accounts.find((item) => item.id === draft.destinationId);
  const category = data.categories.find((item) => item.id === draft.categoryId);
  const currency = draft.currency ?? account?.currency ?? 'GBP';
  const foreign = !!account && currency !== account.currency;
  const amountMinor = Money.parse(draft.amount);
  const stored = foreign ? ledger.rates.rate(currency, account.currency) : null;
  const suggestions = !existing && draft.kind !== 'transfer' && draft.note.length >= 2
    ? ledger.entries.payees(draft.note, draft.kind).filter((payee) => payee.note !== draft.note)
    : [];
  const deleted = !!existing?.deleted_at;

  const template = (): EntryTemplate => ({
    kind: draft.kind,
    account_id: draft.accountId ?? undefined,
    destination_id: draft.kind === 'transfer' ? draft.destinationId : null,
    category_id: draft.kind === 'transfer' ? null : draft.categoryId,
    amount_minor: amountMinor ? Math.abs(amountMinor) : undefined,
    currency: foreign ? currency : null,
    note: draft.note,
    description: draft.description,
    negative: draft.kind !== 'transfer' && (draft.negative || (amountMinor ?? 0) < 0),
    refund_of_id: draft.refundOfId,
    rate: foreign && draft.rate ? draft.rate : null,
    account_amount_minor: foreign && draft.exact ? Money.parse(draft.exact) : null,
  });

  const save = (another: boolean) => {
    if (!draft.accountId) return attempt(() => { throw new Error('Choose an account'); });
    if (!amountMinor) return attempt(() => { throw new Error('Enter an amount'); });
    const ok = attempt(() => {
      const input = { ...template(), occurred_at: draft.date.toISOString() } as EntryInput;
      if (existing) ledger.entries.save(input, existing);
      else if (repeat !== 'none') {
        // A repeating entry is recorded by its schedule, starting with this occurrence.
        ledger.capture.saveSchedule({
          name: draft.note || category?.name || 'Repeating entry', template: template(), frequency: repeat, every: 1,
          start_date: dayKey(draft.date), local_time: timeLabel(draft.date),
        });
        ledger.capture.runDue();
      } else ledger.entries.save(input);
      ledger.settings.set('last_account', draft.accountId!);
    });
    if (!ok) return;
    if (another) set({ amount: '', note: '', description: '', rate: '', exact: '', refundOfId: null });
    else router.back();
  };

  const remove = () => {
    if (attempt(() => ledger.entries.setDeleted(existing!.id, true, existing!.version))) router.back();
  };

  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 24 * 3600 * 1000));
  const draftDay = dayKey(draft.date);
  const setDay = (daysAgo: number) => {
    const now = new Date();
    set({ date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, now.getHours(), now.getMinutes()) });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: existing ? (deleted ? 'Deleted entry' : 'Edit entry') : draft.refundOfId ? 'Money back' : 'New entry',
          headerLeft: () => <IconButton icon="close" label="Close" onPress={() => router.back()} />,
          headerRight: () =>
            !existing && data.bookmarks.length > 0 ? <IconButton icon="bookmark-outline" label="Start from a bookmark" onPress={() => setSheet('bookmarks')} /> : null,
        }}
      />
      <Screen
        footer={
          deleted ? (
            <View style={{ flexDirection: 'row', gap: 10, padding: 16 }}>
              <Button
                title="Erase forever" kind="danger" style={{ flex: 1 }}
                onPress={() => confirm('Erase forever?', 'This cannot be undone.', 'Erase', () => attempt(() => ledger.entries.purge(existing!.id)) && router.back())}
              />
              <Button
                title="Restore" style={{ flex: 1 }}
                onPress={() => attempt(() => ledger.entries.setDeleted(existing!.id, false, existing!.version)) && router.back()}
              />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10, padding: 16 }}>
              {!existing && <Button title="Save + another" kind="secondary" style={{ flex: 1 }} onPress={() => save(true)} />}
              <Button title="Save" style={{ flex: 1 }} onPress={() => save(false)} />
            </View>
          )
        }>
        {deleted && <Notice>This entry is in the recycle bin and has no effect on balances. Restore it to edit it.</Notice>}
        <Segmented options={KINDS} value={draft.kind} onChange={(kind) => set({ kind, categoryId: null, refundOfId: null, negative: kind === 'transfer' ? false : draft.negative })} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderRadius: 14, paddingHorizontal: 12 }}>
          {draft.kind !== 'transfer' && (
            <Pressable
              onPress={() => set({ negative: !draft.negative, refundOfId: draft.negative ? null : draft.refundOfId })}
              accessibilityRole="button"
              accessibilityLabel={draft.negative ? 'Money back, on. Turn off' : 'Mark as money back'}
              style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: draft.negative ? c.accent : c.background }}>
              <T color={draft.negative ? c.onAccent : c.muted} style={{ fontSize: 20, fontWeight: '600' }}>±</T>
            </Pressable>
          )}
          <TextInput
            value={draft.amount}
            onChangeText={(amount) => set({ amount })}
            placeholder="0.00"
            placeholderTextColor={c.faint}
            keyboardType="decimal-pad"
            autoFocus={!existing}
            accessibilityLabel="Amount"
            style={{ flex: 1, minWidth: 0, fontSize: 36, fontWeight: '700', color: c.text, minHeight: 72, fontVariant: ['tabular-nums'] }}
          />
          <Chip label={currency} onPress={draft.kind === 'transfer' ? undefined : () => setSheet('currency')} />
        </View>
        {draft.negative && (
          <T variant="small" muted>
            Money back: this {draft.kind === 'income' ? 'takes money out of the account and reduces income' : 'puts money into the account and reduces spending'}.
          </T>
        )}

        {foreign && (
          <View style={{ gap: 10 }}>
            <Notice tone="info">
              {amountMinor && (draft.exact || draft.rate || stored)
                ? `${Money.format(Math.abs(amountMinor), currency)} reaches ${account.name} as ${Money.format(
                    draft.exact ? Money.parse(draft.exact) ?? 0 : Money.convert(Math.abs(amountMinor), Money.rate(draft.rate) ?? stored?.rate ?? '1'),
                    account.currency,
                  )}${draft.exact ? ' (exact amount)' : draft.rate ? ' (your rate)' : ` (${stored!.source === 'manual' ? 'your saved rate' : 'reference rate'} ${stored!.rate})`}.`
                : stored || draft.rate || draft.exact
                  ? `Paid in ${currency}; ${account.name} is in ${account.currency}.`
                  : `No exchange rate from ${currency} to ${account.currency} yet. Enter a rate or the exact amount below.`}
            </Notice>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label={`Rate (${currency} to ${account.currency})`} value={draft.rate} onChangeText={(rate) => set({ rate, exact: '' })} keyboardType="decimal-pad" placeholder={stored?.rate ?? 'e.g. 0.85'} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={`Exact ${account.currency}`} value={draft.exact} onChangeText={(exact) => set({ exact, rate: '' })} keyboardType="decimal-pad" placeholder="e.g. 17.23" />
              </View>
            </View>
          </View>
        )}

        {data.purchase && (
          <Section title="Pays back">
            <Row
              title={entryTitle(data.purchase)}
              subtitle={`Cost ${Money.format(data.purchase.amount_minor, data.purchase.currency)} · ${Money.format(data.purchase.refunded_minor, data.purchase.currency)} back so far`}
              onPress={() => router.push({ pathname: '/entry', params: { id: data.purchase!.id } })}
            />
          </Section>
        )}

        <View style={{ gap: 8 }}>
          <Field
            label={draft.kind === 'expense' ? 'Paid to' : draft.kind === 'income' ? 'Received from' : 'Note'}
            value={draft.note} onChangeText={(note) => set({ note })} placeholder={draft.kind === 'transfer' ? 'Optional' : 'Who?'}
            autoCapitalize="words"
          />
          {suggestions.length > 0 && (
            <ChipRow>
              {suggestions.map((payee) => (
                <Chip
                  key={payee.note} label={payee.note}
                  onPress={() => set({ note: payee.note, categoryId: draft.categoryId ?? payee.category_id, accountId: params.account_id ? draft.accountId : payee.account_id })}
                />
              ))}
            </ChipRow>
          )}
        </View>

        {draft.kind !== 'transfer' && (
          <View style={{ gap: 6 }}>
            <T variant="label">Category</T>
            <ChipRow wrap>
              {category ? (
                <Chip label={category.name} selected onPress={() => set({ categoryId: null })} />
              ) : (
                data.quick.map((id) => {
                  const item = data.categories.find((candidate) => candidate.id === id);
                  return item ? <Chip key={id} label={item.name} onPress={() => set({ categoryId: id })} /> : null;
                })
              )}
              <Chip label="All categories" icon="grid-outline" onPress={() => setSheet('category')} />
            </ChipRow>
          </View>
        )}

        {draft.kind === 'transfer' ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
            <View style={{ flex: 1 }}>
              <Choice label="From" value={account?.name ?? null} onPress={() => setSheet('account')} />
            </View>
            <IconButton icon="swap-horizontal" label="Swap from and to" onPress={() => set({ accountId: draft.destinationId, destinationId: draft.accountId })} />
            <View style={{ flex: 1 }}>
              <Choice label="To" value={destination?.name ?? null} onPress={() => setSheet('destination')} />
            </View>
          </View>
        ) : (
          <Choice label="Account" value={account?.name ?? null} placeholder="Choose an account" onPress={() => setSheet('account')} />
        )}

        <View style={{ gap: 6 }}>
          <T variant="label">When</T>
          <ChipRow wrap>
            <Chip label="Today" selected={draftDay === today} onPress={() => setDay(0)} />
            <Chip label="Yesterday" selected={draftDay === yesterday} onPress={() => setDay(1)} />
            <Chip
              label={draftDay === today || draftDay === yesterday ? `Pick · ${timeLabel(draft.date)}` : `${dayLabel(draft.date)} · ${timeLabel(draft.date)}`}
              icon="calendar-outline" selected={draftDay !== today && draftDay !== yesterday} onPress={() => setSheet('date')}
            />
          </ChipRow>
        </View>

        {more ? (
          <>
            <Field label="Description" value={draft.description} onChangeText={(description) => set({ description })} multiline placeholder="Anything worth remembering" />
            {!existing && (
              <View style={{ gap: 6 }}>
                <T variant="label">Repeat</T>
                <Segmented options={REPEATS} value={repeat} onChange={setRepeat} />
                {repeat !== 'none' && <T variant="small" muted>Recorded automatically from {dayLabel(draft.date)}, {repeat}. Manage it under More, Repeating entries.</T>}
              </View>
            )}
            {!deleted && (
              <Button
                title="Save as bookmark" kind="secondary" icon="bookmark-outline"
                onPress={() => {
                  setBookmarkName(draft.note || category?.name || '');
                  setSheet('bookmark-name');
                }}
              />
            )}
          </>
        ) : (
          <Button title="More options" kind="plain" small onPress={() => setMore(true)} />
        )}

        {data.refunds.length > 0 && (
          <Section title="Money back on this">
            <Rows>
              {data.refunds.map((refund) => (
                <Row
                  key={refund.id} title={Money.format(refund.amount_minor, refund.currency)}
                  subtitle={`${dayLabel(new Date(refund.occurred_at))} · ${refund.account_name}`}
                  onPress={() => router.push({ pathname: '/entry', params: { id: refund.id } })}
                />
              ))}
            </Rows>
          </Section>
        )}

        {existing && !deleted && (
          <Section>
            <Rows>
              {existing.kind === 'expense' && !existing.negative && existing.refunded_minor < existing.amount_minor && (
                <Row title="Record money back on this" icon="return-up-back" onPress={() => router.push({ pathname: '/entry', params: { refund_of: existing.id } })} />
              )}
              <Row title="Change history" icon="time-outline" onPress={() => router.push({ pathname: '/history/[id]', params: { id: existing.id } })} />
              <Row title="Move to recycle bin" icon="trash-outline" danger chevron={false} onPress={remove} />
            </Rows>
          </Section>
        )}
        {existing?.is_adjustment ? <T variant="small" muted>This entry is a balance correction.</T> : null}
      </Screen>

      <PickerSheet
        visible={sheet === 'account'} onClose={() => setSheet(null)} title={draft.kind === 'transfer' ? 'From' : 'Account'}
        options={data.accountOptions} value={draft.accountId} onPick={(accountId) => set({ accountId })}
      />
      <PickerSheet visible={sheet === 'destination'} onClose={() => setSheet(null)} title="To" options={data.accountOptions} value={draft.destinationId} onPick={(destinationId) => set({ destinationId })} />
      <PickerSheet visible={sheet === 'category'} onClose={() => setSheet(null)} title="Category" options={data.categoryOptions} value={draft.categoryId} onPick={(categoryId) => set({ categoryId })} />
      <PickerSheet
        visible={sheet === 'currency'} onClose={() => setSheet(null)} title="Paid in" value={currency}
        options={CURRENCIES.map((code) => ({ value: code, label: code, detail: code === account?.currency ? "Account's currency" : undefined }))}
        onPick={(code) => set({ currency: code === account?.currency ? null : code, rate: '', exact: '' })}
      />
      <PickerSheet
        visible={sheet === 'bookmarks'} onClose={() => setSheet(null)} title="Bookmarks"
        options={data.bookmarks.map((bookmark) => ({ value: bookmark.id, label: bookmark.name }))}
        onPick={(id) => setDraft((current) => fromTemplate(current, data.bookmarks.find((bookmark) => bookmark.id === id)!.template))}
      />
      <DateSheet visible={sheet === 'date'} onClose={() => setSheet(null)} value={draft.date} onChange={(date) => set({ date })} time />
      <Sheet visible={sheet === 'bookmark-name'} onClose={() => setSheet(null)} title="Save as bookmark">
        <Field label="Name" value={bookmarkName} onChangeText={setBookmarkName} autoFocus />
        <T variant="small" muted>A bookmark is a reusable starting point. It records nothing until you save an entry from it.</T>
        <Button title="Save bookmark" onPress={() => attempt(() => ledger.capture.saveBookmark(bookmarkName, template())) && setSheet(null)} />
      </Sheet>
    </>
  );
}

export default function EntryScreen() {
  const params = useLocalSearchParams<Params>();
  // A different entry (or starting point) is a different form.
  return <Editor key={JSON.stringify(params)} params={params} />;
}
