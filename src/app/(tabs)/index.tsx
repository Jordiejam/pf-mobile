import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Money, type AccountWithBalance } from '@/core';
import { useLive } from '@/platform/app';
import { Fab } from '@/ui/fab';
import { Amount, Card, Chip, ChipRow, Divider, Empty, IconButton, Notice, Button, Screen, T } from '@/ui/kit';
import { useColors } from '@/ui/theme';

function AccountLine({ account, detail }: { account: AccountWithBalance; detail?: string }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/account/[id]', params: { id: account.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${account.name}, ${Money.format(account.balance, account.currency)}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 48, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flex: 1 }}>
        <T color={account.archived ? c.muted : c.text} numberOfLines={1}>{account.name}</T>
        {!!detail && <T variant="small" muted>{detail}</T>}
      </View>
      <Amount color={account.balance < 0 ? c.expense : c.text}>{Money.format(account.balance, account.currency)}</Amount>
    </Pressable>
  );
}

export default function AccountsScreen() {
  const c = useColors();
  const [viewId, setViewId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const data = useLive(
    (ledger) => {
      const primary = ledger.settings.primaryCurrency;
      const views = ledger.views.list();
      const view = views.find((item) => item.id === viewId);
      const all = ledger.accounts.list({ archived: true });
      const chosen = view ? new Set(ledger.views.accountIds(view.id)) : null;
      const shown = all.filter((account) => !account.archived && (!chosen || chosen.has(account.id)));
      return {
        primary, views, view, shown,
        archived: all.filter((account) => account.archived),
        groups: ledger.accounts.groups(),
        totals: ledger.accounts.totals(shown, primary),
        cards: new Map(shown.map((account) => [account.id, ledger.cards.statement(account)])),
        hasAccounts: all.length > 0,
      };
    },
    [viewId],
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <IconButton icon="funnel-outline" label="Edit account views" onPress={() => router.push('/manage/views')} size={22} />
              <IconButton icon="add" label="Add account" onPress={() => router.push('/account/edit')} size={28} />
            </View>
          ),
        }}
      />
      <Screen>
        {data.views.length > 0 && (
          <ChipRow>
            <Chip label="Home" selected={!data.view} onPress={() => setViewId(null)} />
            {data.views.map((view) => (
              <Chip key={view.id} label={view.name} selected={data.view?.id === view.id} onPress={() => setViewId(view.id)} />
            ))}
          </ChipRow>
        )}

        <Card style={{ padding: 16, gap: 10 }}>
          <View>
            <T variant="label">{data.view?.name ?? 'Total'}</T>
            <Amount size={32} weight="700">{Money.format(data.totals.total, data.primary)}</Amount>
          </View>
          <View style={{ flexDirection: 'row', gap: 24 }}>
            <View>
              <T variant="small" muted>Assets</T>
              <Amount>{Money.format(data.totals.assets, data.primary)}</Amount>
            </View>
            <View>
              <T variant="small" muted>Liabilities</T>
              <Amount color={data.totals.liabilities < 0 ? c.expense : c.text}>{Money.format(data.totals.liabilities, data.primary)}</Amount>
            </View>
          </View>
        </Card>
        {data.totals.ratesNeeded.length > 0 && (
          <Notice>
            Rates needed: accounts in {data.totals.ratesNeeded.join(', ')} are left out of these totals until there is an exchange rate. Add one under More, Exchange rates.
          </Notice>
        )}

        {!data.hasAccounts && (
          <Empty
            icon="wallet-outline"
            title="Add your first account"
            hint="An account is anywhere money sits: a bank account, cash, a credit card, a pension."
            action={
              <View style={{ gap: 8 }}>
                <Button title="Add account" icon="add" onPress={() => router.push('/account/edit')} />
                <Button title="Or load sample data" kind="plain" onPress={() => router.push('/manage/data')} />
              </View>
            }
          />
        )}

        {data.groups.map((group) => {
          const accounts = data.shown.filter((account) => account.group_id === group.id);
          if (accounts.length === 0) return null;
          const subtotal = accounts.every((account) => account.currency === data.primary)
            ? Money.format(accounts.reduce((sum, account) => sum + account.balance, 0), data.primary)
            : null;
          return (
            <View key={group.id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 }}>
                <T variant="label">{group.name}</T>
                {subtotal && <T variant="small" muted>{subtotal}</T>}
              </View>
              <Card>
                {accounts.map((account, index) => {
                  const card = data.cards.get(account.id);
                  const detail = card
                    ? `Payable ${Money.format(card.payable, account.currency)} · Outstanding ${Money.format(card.outstanding, account.currency)}`
                    : account.account_type === 'valued' ? 'Valued' : undefined;
                  return (
                    <View key={account.id}>
                      {index > 0 && <Divider />}
                      <AccountLine account={account} detail={detail} />
                    </View>
                  );
                })}
              </Card>
            </View>
          );
        })}

        {data.archived.length > 0 && (
          <View style={{ gap: 8 }}>
            <Button
              title={showArchived ? 'Hide archived accounts' : `Show archived accounts (${data.archived.length})`}
              kind="plain" small onPress={() => setShowArchived(!showArchived)}
            />
            {showArchived && (
              <Card>
                {data.archived.map((account, index) => (
                  <View key={account.id}>
                    {index > 0 && <Divider />}
                    <AccountLine account={account} detail="Archived" />
                  </View>
                ))}
              </Card>
            )}
          </View>
        )}
      </Screen>
      {data.hasAccounts && <Fab />}
    </>
  );
}
