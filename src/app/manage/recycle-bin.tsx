import { View } from 'react-native';
import { EntryFeed } from '@/ui/entries';
import { T } from '@/ui/kit';
import { useColors } from '@/ui/theme';

export default function RecycleBinScreen() {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <EntryFeed
        filter={{ deleted: true }}
        emptyHint="Deleted transactions wait here until you restore or erase them."
        header={<T variant="small" muted style={{ padding: 16, paddingBottom: 0 }}>Deleted transactions have no effect on balances. Open one to restore or erase it.</T>}
      />
    </View>
  );
}
