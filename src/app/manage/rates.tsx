import { useState } from 'react';
import { CURRENCIES, dayLabel, STALE_AFTER_DAYS } from '@/core';
import { useLedger, useLive } from '@/platform/app';
import { attempt, Button, Card, Choice, Field, PickerSheet, Row, Rows, Screen, Section, Sheet, showError, T, Toggle } from '@/ui/kit';

export default function RatesScreen() {
  const ledger = useLedger();
  const data = useLive((live) => ({
    rates: live.rates.list(),
    auto: live.settings.get('fx_auto_refresh') !== '0',
    primary: live.settings.primaryCurrency,
  }));
  const [editing, setEditing] = useState<{ base: string; quote: string; rate: string } | null>(null);
  const [picking, setPicking] = useState<'base' | 'quote' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const manual = data.rates.filter((rate) => rate.source === 'manual');
  const reference = data.rates.filter((rate) => rate.source === 'reference');
  const old = (asOf: string) => Date.now() - new Date(asOf).getTime() > STALE_AFTER_DAYS * 24 * 3600 * 1000;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await ledger.rates.refresh(fetch);
    } catch {
      showError(new Error('Could not fetch rates. Check your connection and try again.'));
    }
    setRefreshing(false);
  };

  return (
    <Screen>
      <T muted>
        Rates price entries made in another currency and combine balances into {data.primary}. An entry keeps the rate it was saved with, whatever happens to rates later.
      </T>
      <Section title="Your rates" action={<Button title="Add" small kind="plain" onPress={() => setEditing({ base: 'EUR', quote: data.primary === 'EUR' ? 'GBP' : data.primary, rate: '' })} />}>
        {manual.length === 0 ? (
          <Row title="None" subtitle="A rate you set here is always used in place of the reference rate" />
        ) : (
          <Rows>
            {manual.map((rate) => (
              <Row key={rate.base + rate.quote} title={`1 ${rate.base} = ${rate.rate} ${rate.quote}`} subtitle={`Set ${dayLabel(new Date(rate.as_of))}`} onPress={() => setEditing(rate)} />
            ))}
          </Rows>
        )}
      </Section>
      <Section title="Reference rates (European Central Bank)">
        {reference.length === 0 ? (
          <Row title="Not fetched yet" />
        ) : (
          <Rows>
            {reference.map((rate) => (
              <Row key={rate.quote} title={`1 EUR = ${rate.rate} ${rate.quote}`} value={`${dayLabel(new Date(rate.as_of))}${old(rate.as_of) ? ' · old' : ''}`} dense />
            ))}
          </Rows>
        )}
      </Section>
      <Button title={refreshing ? 'Fetching…' : 'Fetch reference rates now'} kind="secondary" disabled={refreshing} onPress={refresh} />
      <Card>
        <Toggle
          title="Fetch reference rates daily" value={data.auto}
          subtitle="The request to frankfurter.dev contains only currency codes, nothing about you or your money"
          onChange={(auto) => ledger.settings.set('fx_auto_refresh', auto ? '1' : '0')}
        />
      </Card>

      <Sheet visible={!!editing && !picking} onClose={() => setEditing(null)} title="Your rate">
        <Choice label="From" value={editing?.base ?? null} onPress={() => setPicking('base')} />
        <Choice label="To" value={editing?.quote ?? null} onPress={() => setPicking('quote')} />
        <Field label={`1 ${editing?.base} in ${editing?.quote}`} value={editing?.rate ?? ''} onChangeText={(rate) => setEditing({ ...editing!, rate })} keyboardType="decimal-pad" placeholder="e.g. 0.85" />
        <Button title="Save" onPress={() => attempt(() => ledger.rates.setManual(editing!.base, editing!.quote, editing!.rate)) && setEditing(null)} />
        {manual.some((rate) => rate.base === editing?.base && rate.quote === editing?.quote) && (
          <Button
            title="Remove" kind="danger"
            onPress={() => {
              ledger.rates.removeManual(editing!.base, editing!.quote);
              setEditing(null);
            }}
          />
        )}
      </Sheet>
      <PickerSheet
        visible={!!picking} onClose={() => setPicking(null)} title={picking === 'base' ? 'From' : 'To'}
        value={picking === 'base' ? editing?.base : editing?.quote}
        options={CURRENCIES.map((code) => ({ value: code as string, label: code }))}
        onPick={(code) => setEditing({ ...editing!, [picking!]: code })}
      />
    </Screen>
  );
}
