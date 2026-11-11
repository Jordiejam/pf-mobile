import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Money, monthName } from '@/core';
import { useLive } from '@/platform/app';
import { Bars, Donut, LineChart } from '@/ui/charts';
import { Amount, Card, Chip, ChipRow, Divider, Empty, Notice, Screen, Segmented, T } from '@/ui/kit';
import { PeriodBar, usePeriod } from '@/ui/period';
import { SERIES, useColors } from '@/ui/theme';

type Mode = 'expense' | 'income' | 'worth';
const MODES: { value: Mode; label: string }[] = [
  { value: 'expense', label: 'Spending' },
  { value: 'income', label: 'Income' },
  { value: 'worth', label: 'Net worth' },
];

function Flow({ kind }: { kind: 'expense' | 'income' }) {
  const c = useColors();
  const period = usePeriod();
  const [viewId, setViewId] = useState<string | null>(null);
  const rangeKey = JSON.stringify(period.range);
  const data = useLive(
    (ledger) => {
      const primary = ledger.settings.primaryCurrency;
      const views = ledger.views.list();
      const account_ids = viewId ? ledger.views.accountIds(viewId) : undefined;
      const filter = { ...period.range, account_ids };
      return {
        primary, views,
        breakdown: ledger.reports.byCategory(kind, filter, primary),
        months: ledger.reports.months(6, ledger.settings.monthStartDay, primary, { account_ids }),
      };
    },
    [kind, rangeKey, viewId],
  );
  const { breakdown } = data;
  // Money back can leave a category negative for a period; shares are of what was actually spent.
  const positive = breakdown.categories.reduce((sum, category) => sum + Math.max(category.total, 0), 0);
  const colour = (index: number) => SERIES[index % SERIES.length];

  return (
    <>
      <PeriodBar state={period} />
      {data.views.length > 0 && (
        <ChipRow>
          <Chip label="All accounts" selected={!viewId} onPress={() => setViewId(null)} />
          {data.views.map((view) => <Chip key={view.id} label={view.name} selected={viewId === view.id} onPress={() => setViewId(view.id)} />)}
        </ChipRow>
      )}
      <Card style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T variant="label">Last 6 months</T>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <T variant="small" color={c.income}>● Income</T>
            <T variant="small" color={c.expense}>● Spending</T>
          </View>
        </View>
        <Bars
          data={data.months.map((month) => ({ label: monthName(month.period.start.getMonth()), values: [month.income, month.expense] }))}
          colors={[c.income, c.expense]}
        />
      </Card>

      {breakdown.ratesNeeded.length > 0 && (
        <Notice>Entries on accounts in {breakdown.ratesNeeded.join(', ')} are left out until there is an exchange rate.</Notice>
      )}
      {breakdown.categories.length === 0 ? (
        <Empty icon="pie-chart-outline" title={`No ${kind === 'expense' ? 'spending' : 'income'} in this period`} />
      ) : (
        <>
          <Card style={{ padding: 16, alignItems: 'center' }}>
            <Donut slices={breakdown.categories.map((category, index) => ({ value: category.total, color: colour(index) }))}>
              <T variant="small" muted>{kind === 'expense' ? 'Spent' : 'Received'}</T>
              <Amount size={20} weight="700">{Money.format(breakdown.total, data.primary)}</Amount>
            </Donut>
          </Card>
          <Card>
            {breakdown.categories.map((category, index) => (
              <View key={category.id}>
                {index > 0 && <Divider />}
                <Pressable
                  onPress={() => router.push({ pathname: '/category/[id]', params: { id: category.id, ...period.range } })}
                  accessibilityRole="button"
                  style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 10, gap: 4, opacity: pressed ? 0.6 : 1 })}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colour(index) }} />
                    <T style={{ flex: 1 }} numberOfLines={1}>{category.name}</T>
                    <T variant="small" muted>{category.total > 0 && positive > 0 ? `${Math.round((category.total / positive) * 100)}%` : ''}</T>
                    <Amount>{Money.format(category.total, data.primary)}</Amount>
                  </View>
                  {category.children.map((child) => (
                    <View key={child.id} style={{ flexDirection: 'row', paddingLeft: 22 }}>
                      <T variant="small" muted style={{ flex: 1 }}>{child.name}</T>
                      <T variant="small" muted>{Money.format(child.total, data.primary)}</T>
                    </View>
                  ))}
                </Pressable>
              </View>
            ))}
          </Card>
        </>
      )}
    </>
  );
}

const RANGES = [{ value: '6', label: '6M' }, { value: '12', label: '1Y' }, { value: '24', label: '2Y' }];

function Worth() {
  const c = useColors();
  const [range, setRange] = useState('12');
  const data = useLive(
    (ledger) => {
      const primary = ledger.settings.primaryCurrency;
      const points = ledger.reports.netWorth(Number(range), ledger.settings.monthStartDay, primary);
      return { primary, points, groups: ledger.accounts.groups() };
    },
    [range],
  );
  const latest = data.points.at(-1)!;
  const previous = data.points.at(-2);
  const first = data.points[0];
  const change = (from?: { total: number }) => (from ? latest.total - from.total : 0);
  const groups = data.groups.filter((group) => latest.groups[group.id]).sort((a, b) => Math.abs(latest.groups[b.id]) - Math.abs(latest.groups[a.id]));
  const largest = Math.max(1, ...groups.map((group) => Math.abs(latest.groups[group.id])));

  return (
    <>
      <Card style={{ padding: 16, gap: 12 }}>
        <View>
          <T variant="label">Net worth</T>
          <Amount size={32} weight="700">{Money.format(latest.total, data.primary)}</Amount>
          <T variant="small" color={change(previous) >= 0 ? c.income : c.expense}>
            {Money.format(change(previous), data.primary, { sign: true })} this month · {Money.format(change(first), data.primary, { sign: true })} over {RANGES.find((item) => item.value === range)!.label}
          </T>
        </View>
        <LineChart values={data.points.map((point) => point.total)} color={c.accent} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T variant="small" muted>{monthName(first.period.start.getMonth())} {first.period.start.getFullYear()}</T>
          <T variant="small" muted>Now</T>
        </View>
        <Segmented options={RANGES} value={range} onChange={setRange} />
      </Card>
      <Card style={{ padding: 16, gap: 12 }}>
        <T variant="label">By group</T>
        {groups.length === 0 && <T muted>No accounts count towards net worth yet.</T>}
        {groups.map((group, index) => {
          const value = latest.groups[group.id];
          return (
            <View key={group.id} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T>{group.name}</T>
                <Amount color={value < 0 ? c.expense : c.text}>{Money.format(value, data.primary)}</Amount>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: c.line }}>
                <View style={{ height: 6, borderRadius: 3, width: `${(Math.abs(value) / largest) * 100}%`, backgroundColor: value < 0 ? c.expense : SERIES[index % SERIES.length] }} />
              </View>
            </View>
          );
        })}
      </Card>
      <T variant="small" muted>
        Month-end values of the accounts set to count in net worth (change this in an account's settings). Accounts in other currencies are valued at today's rate.
      </T>
    </>
  );
}

export default function StatisticsScreen() {
  const [mode, setMode] = useState<Mode>('expense');
  return (
    <Screen>
      <Segmented options={MODES} value={mode} onChange={setMode} />
      {mode === 'worth' ? <Worth /> : <Flow key={mode} kind={mode} />}
    </Screen>
  );
}
