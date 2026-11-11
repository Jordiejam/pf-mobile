import * as LocalAuthentication from 'expo-local-authentication';
import { useState } from 'react';
import { Platform } from 'react-native';
import { CURRENCIES } from '@/core';
import { useLedger, useLive } from '@/platform/app';
import { attempt, Card, PickerSheet, Row, Rows, Screen, Section, showError, T, Toggle } from '@/ui/kit';

const THEMES = [
  { value: 'system', label: 'Match the phone' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const ledger = useLedger();
  const settings = useLive((live) => ({
    currency: live.settings.primaryCurrency,
    startDay: live.settings.monthStartDay,
    theme: live.settings.get('theme') ?? 'system',
    lock: live.settings.get('app_lock') === '1',
  }));
  const [sheet, setSheet] = useState<'currency' | 'day' | 'theme' | null>(null);

  const setLock = async (on: boolean) => {
    if (on) {
      // Prove the lock can be opened before turning it on.
      const enrolled = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
      if (!enrolled) return showError(new Error('Set up Face ID, a fingerprint or a passcode on this phone first.'));
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Turn on app lock' });
      if (!result.success) return;
    }
    ledger.settings.set('app_lock', on ? '1' : '0');
  };

  return (
    <Screen>
      <Section title="Money">
        <Rows>
          <Row title="Primary currency" value={settings.currency} onPress={() => setSheet('currency')} subtitle="Totals and statistics are shown in this currency" />
          <Row title="Month starts on day" value={String(settings.startDay)} onPress={() => setSheet('day')} subtitle="For example your payday" />
        </Rows>
      </Section>
      <Section title="Appearance">
        <Row title="Theme" value={THEMES.find((theme) => theme.value === settings.theme)?.label} onPress={() => setSheet('theme')} />
      </Section>
      {Platform.OS !== 'web' && (
        <Card>
          <Toggle title="App lock" subtitle="Ask for Face ID, fingerprint or passcode when the app opens" value={settings.lock} onChange={setLock} />
        </Card>
      )}
      <T variant="small" muted>
        Changing the primary currency does not convert anything: each account keeps its own currency, and totals are converted at today's rates.
      </T>
      <PickerSheet
        visible={sheet === 'currency'} onClose={() => setSheet(null)} title="Primary currency" value={settings.currency as string}
        options={CURRENCIES.map((code) => ({ value: code as string, label: code }))}
        onPick={(code) => attempt(() => ledger.settings.setPrimaryCurrency(code))}
      />
      <PickerSheet
        visible={sheet === 'day'} onClose={() => setSheet(null)} title="Month starts on day" value={settings.startDay}
        options={Array.from({ length: 31 }, (_, index) => ({ value: index + 1, label: String(index + 1) }))}
        onPick={(day) => attempt(() => ledger.settings.setMonthStartDay(day))}
      />
      <PickerSheet visible={sheet === 'theme'} onClose={() => setSheet(null)} title="Theme" value={settings.theme} options={THEMES} onPick={(theme) => ledger.settings.set('theme', theme)} />
    </Screen>
  );
}
