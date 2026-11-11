import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { useColors } from './theme';

/** The one obvious action: add a transaction, prefilled with the account being viewed. */
export function Fab({ accountId }: { accountId?: string }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/entry', params: accountId ? { account_id: accountId } : {} })}
      accessibilityRole="button"
      accessibilityLabel="Add transaction"
      style={({ pressed }) => ({
        position: 'absolute', right: 20, bottom: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: c.accent,
        alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1,
        shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
      })}>
      <Ionicons name="add" size={32} color={c.onAccent} />
    </Pressable>
  );
}
