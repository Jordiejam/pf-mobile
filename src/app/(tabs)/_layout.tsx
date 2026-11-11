import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { useColors } from '@/ui/theme';
import type { IconName } from '@/ui/kit';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Accounts', icon: 'wallet-outline' },
  { name: 'transactions', title: 'Transactions', icon: 'list-outline' },
  { name: 'assistant', title: 'Assistant', icon: 'sparkles-outline' },
  { name: 'statistics', title: 'Statistics', icon: 'pie-chart-outline' },
  { name: 'more', title: 'More', icon: 'ellipsis-horizontal' },
];

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.line },
        headerStyle: { backgroundColor: c.background },
        headerTitleStyle: { color: c.text },
        headerShadowVisible: false,
      }}>
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{ title: tab.title, tabBarIcon: ({ color, size }) => <Ionicons name={tab.icon} size={size} color={color as string} /> }}
        />
      ))}
    </Tabs>
  );
}
