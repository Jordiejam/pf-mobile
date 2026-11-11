import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useLive } from '@/platform/app';
import { EntryFeed } from '@/ui/entries';
import { useColors } from '@/ui/theme';

/** A category's entries (its subcategories included) for the period it was opened from. */
export default function CategoryScreen() {
  const c = useColors();
  const { id, start, end } = useLocalSearchParams<{ id: string; start?: string; end?: string }>();
  const name = useLive((ledger) => ledger.categories.find(id).name, [id]);
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: name }} />
      <EntryFeed filter={{ category_ids: [id], start, end }} />
    </View>
  );
}
