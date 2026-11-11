import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { AuthError, type ChatGptAuth } from '@/assistant/chatgptAuth';
import { AssistantError, MANAGE_USAGE_URL, type ModelInfo } from '@/assistant/responses';
import { useConnection } from '@/platform/app';
import { chatGptAuth, connection } from '@/platform/connection';
import { Button, confirm, Field, Notice, PickerSheet, Row, Rows, Screen, Section, Sheet, T } from '@/ui/kit';

const words = (error: unknown) =>
  error instanceof AuthError || error instanceof AssistantError ? error.message : 'Something went wrong. Check your connection and try again.';

export default function AssistantConnectionScreen() {
  const state = useConnection();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [keySheet, setKeySheet] = useState(false);
  const [key, setKey] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelSheet, setModelSheet] = useState(false);
  const [customModel, setCustomModel] = useState('');
  const signInAvailable = (chatGptAuth as ChatGptAuth).available();

  const run = async (work: () => Promise<void>) => {
    setWorking(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      if (!(error instanceof AuthError && error.code === 'cancelled')) setProblem(words(error));
    }
    setWorking(false);
  };

  useEffect(() => {
    setModels(null);
    if (state.mode !== 'none') connection.models().then(setModels).catch(() => setModels([]));
  }, [state.mode]);

  return (
    <Screen>
      {problem && <Notice>{problem}</Notice>}

      {state.mode === 'none' ? (
        <>
          <T muted>
            The assistant lets you record spending by describing it and ask questions about your money. It is optional: everything else works without it.
          </T>
          <Section title="Use your ChatGPT plan">
            <View style={{ padding: 16, gap: 12 }}>
              <T muted>Sign in with ChatGPT to use the allowance in your Plus or Pro plan. No API key and no separate bill.</T>
              <Button title={working ? 'Waiting for sign-in…' : 'Sign in with ChatGPT'} disabled={working || !signInAvailable} onPress={() => run(() => connection.signInWithChatGpt())} />
              {!signInAvailable && (
                <T variant="small" muted>
                  Not available here: ChatGPT sign-in needs the installed app (a development or release build). It cannot run inside Expo Go or a browser. Use an API key below to try the assistant now.
                </T>
              )}
            </View>
          </Section>
          <Section title="Or use an OpenAI API key">
            <View style={{ padding: 16, gap: 12 }}>
              <T muted>Uses your own key from platform.openai.com, billed by OpenAI per use. The key is kept in this phone's secure storage.</T>
              <Button title="Enter API key" kind="secondary" disabled={working} onPress={() => setKeySheet(true)} />
            </View>
          </Section>
        </>
      ) : (
        <>
          <Section title="Connected">
            <Rows>
              <Row
                title={state.mode === 'chatgpt' ? 'ChatGPT plan' : 'OpenAI API key'} icon="checkmark-circle"
                subtitle={state.mode === 'chatgpt' ? state.email || 'Signed in' : 'Billed by OpenAI per use'}
              />
              <Row
                title="Model" value={state.model ?? 'Choose'} onPress={() => setModelSheet(true)}
                subtitle={models === null ? 'Loading models…' : undefined}
              />
              {state.mode === 'chatgpt' && <Row title="Manage plan usage" icon="open-outline" onPress={() => Linking.openURL(MANAGE_USAGE_URL)} />}
            </Rows>
          </Section>
          <Button
            title={state.mode === 'chatgpt' ? 'Sign out' : 'Remove API key'} kind="danger" disabled={working}
            onPress={() => confirm('Disconnect the assistant?', 'Your ledger is not affected.', 'Disconnect', () => run(() => connection.disconnect()))}
          />
        </>
      )}

      <Section title="What is shared">
        <View style={{ padding: 16, gap: 8 }}>
          <T muted>When you use the assistant, your message goes to OpenAI together with the ledger details needed to answer it: account and category names, balances and matching transactions.</T>
          <T muted>The assistant can only read and propose. Nothing is saved until you tap Approve on a proposal, and what is saved is exactly what was shown.</T>
          <T muted>Nothing is sent when you are not using the assistant.</T>
        </View>
      </Section>

      <Sheet visible={keySheet} onClose={() => setKeySheet(false)} title="OpenAI API key">
        <Field label="API key" value={key} onChangeText={setKey} placeholder="sk-…" autoCapitalize="none" autoCorrect={false} secureTextEntry autoFocus />
        <Button
          title="Connect" disabled={!key.trim() || working}
          onPress={() => {
            setKeySheet(false);
            run(async () => {
              try {
                await connection.useApiKey(key);
              } catch (error) {
                await connection.disconnect();
                throw error;
              } finally {
                setKey('');
              }
            });
          }}
        />
      </Sheet>
      <PickerSheet
        visible={modelSheet && !!models?.length} onClose={() => setModelSheet(false)} title="Model" value={state.mode === 'none' ? null : state.model}
        options={(models ?? []).map((model) => ({ value: model.id as string | null, label: model.name }))}
        onPick={(model) => model && connection.setModel(model)}
      />
      <Sheet visible={modelSheet && models?.length === 0} onClose={() => setModelSheet(false)} title="Model">
        <T muted>The list of models could not be loaded. You can type a model name instead.</T>
        <Field label="Model name" value={customModel} onChangeText={setCustomModel} autoCapitalize="none" autoCorrect={false} />
        <Button title="Use this model" disabled={!customModel.trim()} onPress={() => connection.setModel(customModel.trim()).then(() => setModelSheet(false))} />
      </Sheet>
    </Screen>
  );
}
