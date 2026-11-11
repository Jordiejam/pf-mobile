import { router } from 'expo-router';
import { Money } from '@/core';
import { useLedger, useLive } from '@/platform/app';
import { Card, confirm, Empty, IconButton, Row, Rows, Screen } from '@/ui/kit';
import { useColors } from '@/ui/theme';

/** Bookmarks are reusable starting points for an entry; they never record anything themselves. */
export default function BookmarksScreen() {
  const c = useColors();
  const ledger = useLedger();
  const bookmarks = useLive((live) => live.capture.bookmarks());
  if (bookmarks.length === 0) {
    return (
      <Screen>
        <Empty icon="bookmark-outline" title="No bookmarks yet" hint="While adding an entry, open More options and choose Save as bookmark. It then appears here and in the entry form." />
      </Screen>
    );
  }
  return (
    <Screen>
      <Card>
        <Rows>
          {bookmarks.map((bookmark) => (
            <Row
              key={bookmark.id} title={bookmark.name}
              subtitle={[bookmark.template.kind, bookmark.template.amount_minor ? Money.plain(bookmark.template.amount_minor) : null].filter(Boolean).join(' · ')}
              onPress={() => router.push({ pathname: '/entry', params: { bookmark: bookmark.id } })}
              right={
                <IconButton
                  icon="trash-outline" label={`Delete ${bookmark.name}`} color={c.danger} size={20}
                  onPress={() => confirm('Delete this bookmark?', bookmark.name, 'Delete', () => ledger.capture.deleteBookmark(bookmark.id))}
                />
              }
            />
          ))}
        </Rows>
      </Card>
    </Screen>
  );
}
