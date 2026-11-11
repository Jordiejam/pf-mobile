import { router } from 'expo-router';
import { useConnection, useLive } from '@/platform/app';
import { Row, Rows, Screen, Section, T } from '@/ui/kit';

export default function MoreScreen() {
  const connection = useConnection();
  const counts = useLive((ledger) => ({
    deleted: ledger.entries.totals({ deleted: true }, ledger.settings.primaryCurrency).count,
    paused: ledger.capture.schedules().filter((schedule) => schedule.error).length,
  }));
  return (
    <Screen>
      <Section title="Ledger">
        <Rows>
          <Row title="Account groups" icon="folder-outline" onPress={() => router.push('/manage/groups')} />
          <Row title="Categories" icon="pricetags-outline" onPress={() => router.push('/manage/categories')} />
          <Row title="Account views" icon="funnel-outline" onPress={() => router.push('/manage/views')} />
          <Row title="Bookmarks" icon="bookmark-outline" onPress={() => router.push('/manage/bookmarks')} />
          <Row
            title="Repeating entries" icon="repeat-outline" onPress={() => router.push('/manage/schedules')}
            subtitle={counts.paused ? `${counts.paused} paused and needing attention` : undefined}
          />
          <Row title="Exchange rates" icon="swap-vertical-outline" onPress={() => router.push('/manage/rates')} />
        </Rows>
      </Section>
      <Section title="Assistant">
        <Row
          title="Assistant connection" icon="sparkles-outline" onPress={() => router.push('/manage/assistant')}
          subtitle={connection.mode === 'chatgpt' ? `ChatGPT plan · ${connection.email}` : connection.mode === 'api_key' ? 'OpenAI API key' : 'Not connected'}
        />
      </Section>
      <Section title="Data">
        <Rows>
          <Row title="Recycle bin" icon="trash-outline" value={counts.deleted ? String(counts.deleted) : undefined} onPress={() => router.push('/manage/recycle-bin')} />
          <Row title="Backup and data" icon="cloud-download-outline" onPress={() => router.push('/manage/data')} />
        </Rows>
      </Section>
      <Section title="Preferences">
        <Row title="Settings" icon="settings-outline" onPress={() => router.push('/manage/settings')} />
      </Section>
      <T variant="small" muted style={{ textAlign: 'center' }}>
        Your ledger is stored only on this phone. Back it up regularly: if the phone is lost without a backup, so is the ledger.
      </T>
    </Screen>
  );
}
