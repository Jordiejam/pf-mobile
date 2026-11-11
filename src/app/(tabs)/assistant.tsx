import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import type { ChatItem } from '@/assistant/agent';
import type { ChangeLine } from '@/core';
import { useChat, useConnection } from '@/platform/app';
import { connection } from '@/platform/connection';
import { Amount, Button, Card, Divider, Empty, IconButton, T } from '@/ui/kit';
import { useColors } from '@/ui/theme';

const ACTIONS: Record<ChangeLine['action'], string> = {
  create: 'Add', edit: 'Change', delete: 'Delete', restore: 'Restore',
  valuation: 'Value', edit_valuation: 'Change value', delete_valuation: 'Delete value',
};

const EXAMPLES = [
  'Spent 12.50 at Tesco yesterday and 3.20 on coffee this morning',
  'How much did I spend on eating out this month?',
  'Paid 250 off my credit card from my current account',
];

/** A proposal from the assistant. Nothing in it is saved until Approve is tapped. */
function Proposal({ item, onApprove, onDiscard }: { item: Extract<ChatItem, { type: 'proposal' }>; onApprove: () => void; onDiscard: () => void }) {
  const c = useColors();
  const { preview } = item;
  return (
    <Card style={{ borderWidth: 1, borderColor: item.status === 'pending' ? c.accent : c.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, paddingBottom: 4 }}>
        <Ionicons
          name={item.status === 'saved' ? 'checkmark-circle' : item.status === 'discarded' ? 'close-circle-outline' : 'document-text-outline'}
          size={20} color={item.status === 'saved' ? c.income : item.status === 'discarded' ? c.muted : c.accent}
        />
        <T variant="heading">
          {item.status === 'saved' ? 'Saved' : item.status === 'discarded' ? (item.error ? 'Not saved' : 'Discarded') : `Proposed ${preview.lines.length === 1 ? 'change' : `${preview.lines.length} changes`}`}
        </T>
      </View>
      {preview.lines.map((line, index) => (
        <View key={index}>
          {index > 0 && <Divider />}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, opacity: item.status === 'discarded' ? 0.5 : 1 }}>
            <View style={{ flex: 1 }}>
              <T numberOfLines={2}>{line.title}</T>
              <T variant="small" muted>{ACTIONS[line.action]} · {line.detail}</T>
              {line.was && <T variant="small" muted>Was {line.was}</T>}
            </View>
            <Amount>{line.amount}</Amount>
          </View>
        </View>
      ))}
      {preview.balances.length > 0 && item.status !== 'discarded' && (
        <View style={{ padding: 12, paddingTop: 6, gap: 2 }}>
          {preview.balances.map((balance) => (
            <T key={balance.account_id} variant="small" muted>
              {balance.name}: {balance.before} → {balance.after}
            </T>
          ))}
        </View>
      )}
      {preview.duplicates.length > 0 && item.status === 'pending' && (
        <View style={{ backgroundColor: c.warnSoft, padding: 12, gap: 2 }}>
          <T variant="small" color={c.warn}>Possible duplicate{preview.duplicates.length > 1 ? 's' : ''} of entries you already have:</T>
          {preview.duplicates.map((duplicate, index) => <T key={index} variant="small" color={c.warn}>{duplicate.existing}</T>)}
        </View>
      )}
      {item.error && <T variant="small" color={c.danger} style={{ padding: 12, paddingTop: 0 }}>{item.error}</T>}
      {item.status === 'pending' && (
        <View style={{ flexDirection: 'row', gap: 10, padding: 12 }}>
          <Button title="Discard" kind="secondary" small style={{ flex: 1 }} onPress={onDiscard} />
          <Button title="Approve" small style={{ flex: 1 }} onPress={onApprove} />
        </View>
      )}
    </Card>
  );
}

function Bubble({ item }: { item: Exclude<ChatItem, { type: 'proposal' }> }) {
  const c = useColors();
  if (item.type === 'activity') {
    return <T variant="small" muted style={{ alignSelf: 'center' }}>{item.text}</T>;
  }
  if (item.type === 'error') {
    return (
      <View style={{ backgroundColor: c.warnSoft, borderRadius: 14, padding: 12 }}>
        <T color={c.warn} variant="small">{item.text}</T>
      </View>
    );
  }
  const mine = item.type === 'user';
  return (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: mine ? c.accent : c.card, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 }}>
      <T color={mine ? c.onAccent : c.text}>{item.text}</T>
    </View>
  );
}

export default function AssistantScreen() {
  const c = useColors();
  const state = useConnection();
  const { assistant, items, busy } = useChat();
  const [text, setText] = useState('');
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [items]);

  const model = state.mode === 'none' ? null : state.model;
  const send = (message = text) => {
    if (!model || busy || !message.trim()) return;
    setText('');
    assistant.send(message, connection.client(), model);
  };

  if (state.mode === 'none' || !model) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: c.background }}>
        <Empty
          icon="sparkles-outline"
          title={state.mode === 'none' ? 'Talk to your ledger' : 'Choose a model'}
          hint={
            state.mode === 'none'
              ? 'Connect ChatGPT to record spending by describing it, and to ask questions about your money. Everything else in the app works without it.'
              : 'The assistant is connected but has no model selected yet.'
          }
          action={<Button title={state.mode === 'none' ? 'Connect' : 'Choose a model'} onPress={() => router.push('/manage/assistant')} />}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90} style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              {items.length > 0 && <IconButton icon="create-outline" label="New conversation" onPress={() => assistant.reset()} size={22} />}
              <IconButton icon="settings-outline" label="Assistant connection" onPress={() => router.push('/manage/assistant')} size={22} />
            </View>
          ),
        }}
      />
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}>
        {items.length === 0 && (
          <View style={{ flex: 1, justifyContent: 'center', gap: 10 }}>
            <T muted style={{ textAlign: 'center', marginBottom: 6 }}>
              Describe what you spent, or ask about your money. Changes are shown for your approval before anything is saved.
            </T>
            {EXAMPLES.map((example) => <Button key={example} title={example} kind="secondary" small onPress={() => send(example)} />)}
            <T variant="small" muted style={{ textAlign: 'center', marginTop: 6 }}>
              What you type, and the ledger details needed to answer, are sent to OpenAI.
            </T>
          </View>
        )}
        {items.map((item) =>
          item.type === 'proposal' ? (
            <Proposal key={item.id} item={item} onApprove={() => assistant.approve(item.id)} onDiscard={() => assistant.discard(item.id)} />
          ) : (
            <Bubble key={item.id} item={item} />
          ),
        )}
        {busy && <T variant="small" muted>Working…</T>}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.line }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type, or dictate with the keyboard's microphone"
          placeholderTextColor={c.faint}
          multiline
          accessibilityLabel="Message"
          style={{ flex: 1, minWidth: 0, minHeight: 44, maxHeight: 140, fontSize: 16, color: c.text, backgroundColor: c.background, borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11 }}
        />
        {busy ? (
          <IconButton icon="stop-circle" label="Stop" onPress={() => assistant.stop()} size={34} />
        ) : (
          <IconButton icon="arrow-up-circle" label="Send" onPress={() => send()} size={34} color={text.trim() ? c.accent : c.faint} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
