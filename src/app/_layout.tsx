import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Text, View } from 'react-native';
import { openLedger, refreshOnForeground, useLive } from '@/platform/app';
import { connection } from '@/platform/connection';
import { Button, Empty } from '@/ui/kit';
import { useColors, useIsDark } from '@/ui/theme';

SplashScreen.preventAutoHideAsync();

/** How long the app may sit in the background before it locks again. */
const LOCK_AFTER_MS = 60_000;

/** Covers the app until the person proves it is them, when app lock is on. */
function LockGate({ children }: { children: ReactNode }) {
  const enabled = useLive((ledger) => ledger.settings.get('app_lock') === '1');
  const [unlocked, setUnlocked] = useState(false);
  const left = useRef(0);

  const unlock = async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock your finances' });
    if (result.success) setUnlocked(true);
  };

  useEffect(() => {
    if (enabled && !unlocked) unlock();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') left.current = Date.now();
      else if (state === 'active') {
        if (left.current && Date.now() - left.current > LOCK_AFTER_MS) setUnlocked(false);
        left.current = 0;
        refreshOnForeground();
      }
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, unlocked]);

  if (!enabled || unlocked) return <>{children}</>;
  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <Empty icon="lock-closed" title="Locked" action={<Button title="Unlock" onPress={unlock} />} />
    </View>
  );
}

function Navigation() {
  const c = useColors();
  const dark = useIsDark();
  const base = dark ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background: c.background, card: c.card, text: c.text, border: c.line, primary: c.accent } }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <LockGate>
          <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerTintColor: c.accent, headerTitleStyle: { color: c.text } }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="entry" options={{ presentation: 'modal', title: 'Entry' }} />
            <Stack.Screen name="account/[id]" options={{ title: 'Account' }} />
            <Stack.Screen name="account/edit" options={{ presentation: 'modal', title: 'Account' }} />
            <Stack.Screen name="category/[id]" options={{ title: 'Category' }} />
            <Stack.Screen name="history/[id]" options={{ title: 'Change history' }} />
            <Stack.Screen name="manage/groups" options={{ title: 'Account groups' }} />
            <Stack.Screen name="manage/categories" options={{ title: 'Categories' }} />
            <Stack.Screen name="manage/views" options={{ title: 'Account views' }} />
            <Stack.Screen name="manage/bookmarks" options={{ title: 'Bookmarks' }} />
            <Stack.Screen name="manage/schedules" options={{ title: 'Repeating entries' }} />
            <Stack.Screen name="manage/rates" options={{ title: 'Exchange rates' }} />
            <Stack.Screen name="manage/recycle-bin" options={{ title: 'Recycle bin' }} />
            <Stack.Screen name="manage/settings" options={{ title: 'Settings' }} />
            <Stack.Screen name="manage/data" options={{ title: 'Backup and data' }} />
            <Stack.Screen name="manage/assistant" options={{ title: 'Assistant connection' }} />
          </Stack>
        </LockGate>
      </View>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [failure, setFailure] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    openLedger()
      .then(() => {
        refreshOnForeground();
        connection.load();
        setReady(true);
      })
      .catch((error) => setFailure(error instanceof Error ? error.message : 'Unknown error'))
      .finally(() => SplashScreen.hideAsync());
  }, []);

  if (failure) {
    // Plain components only: the themed ones read the ledger, which is what failed.
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 32, gap: 12 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', textAlign: 'center' }}>The ledger could not be opened</Text>
        <Text style={{ fontSize: 15, textAlign: 'center', color: '#6B7280' }}>{failure}</Text>
      </View>
    );
  }
  return ready ? <Navigation /> : null;
}
