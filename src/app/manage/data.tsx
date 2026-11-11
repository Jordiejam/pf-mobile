import { useState } from 'react';
import { dayKey, dayLabel, LedgerError, seedDemo } from '@/core';
import { getAssistant, useLedger, useLive } from '@/platform/app';
import { pickTextFile, shareTextFile } from '@/platform/files';
import { attempt, Button, confirm, Notice, Screen, Section, showError, T } from '@/ui/kit';
import { View } from 'react-native';

export default function DataScreen() {
  const ledger = useLedger();
  const lastBackup = useLive((live) => live.settings.get('last_backup_at'));
  const [message, setMessage] = useState<string | null>(null);

  const backUp = async () => {
    try {
      // Recorded first, so the backup itself says when it was made.
      ledger.settings.set('last_backup_at', ledger.store.nowIso());
      await shareTextFile(`pocket-ledger-${dayKey(new Date())}.json`, JSON.stringify(ledger.backup.export()));
      setMessage('Backup created. Keep the file somewhere safe, such as your files app or cloud drive.');
    } catch (error) {
      showError(error);
    }
  };

  const restore = async () => {
    try {
      const text = await pickTextFile();
      if (text === null) return;
      let file: unknown;
      try {
        file = JSON.parse(text);
      } catch {
        throw new LedgerError("This isn't a backup from this app");
      }
      confirm('Replace everything with this backup?', 'Everything in the app now will be replaced by the contents of the backup.', 'Replace', () => {
        if (attempt(() => setMessage(`Restored ${ledger.backup.restore(file).rows} records.`))) getAssistant().reset();
      });
    } catch (error) {
      showError(error);
    }
  };

  return (
    <Screen>
      {message && <Notice tone="info">{message}</Notice>}
      <Section title="Backup">
        <View style={{ padding: 16, gap: 12 }}>
          <T muted>
            Your ledger exists only on this phone. A backup is one file holding everything; restoring one replaces what is here.
            {'\n\n'}
            {lastBackup ? `Last backup: ${dayLabel(new Date(lastBackup))}.` : 'No backup made yet.'}
          </T>
          <Button title="Back up now" icon="share-outline" onPress={backUp} />
          <Button title="Restore from a backup" kind="secondary" onPress={restore} />
          <T variant="small" muted>The backup file is not encrypted. Store it somewhere only you can reach.</T>
        </View>
      </Section>
      <Section title="Try it out">
        <View style={{ padding: 16, gap: 12 }}>
          <T muted>Adds four invented accounts and three months of entries, all marked "(sample)", so you can explore before entering your own.</T>
          <Button title="Load sample data" kind="secondary" onPress={() => attempt(() => seedDemo(ledger)) && setMessage('Sample data added.')} />
        </View>
      </Section>
      <Section title="Start again">
        <View style={{ padding: 16, gap: 12 }}>
          <T muted>Erases every account, transaction and setting on this phone.</T>
          <Button
            title="Erase everything" kind="danger"
            onPress={() => confirm('Erase everything?', 'This cannot be undone. Make a backup first if you might want any of it.', 'Erase', () => {
              if (attempt(() => ledger.backup.erase())) {
                getAssistant().reset();
                setMessage('Everything was erased.');
              }
            })}
          />
        </View>
      </Section>
    </Screen>
  );
}
