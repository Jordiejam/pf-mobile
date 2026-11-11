import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps, type ComponentRef, type ReactNode, useRef, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LedgerError } from '@/core';
import { useColors } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// Text

type Variant = 'title' | 'heading' | 'body' | 'small' | 'label';
const VARIANTS: Record<Variant, TextStyle> = {
  title: { fontSize: 28, fontWeight: '700' },
  heading: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 16 },
  small: { fontSize: 13 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
};

export function T(props: {
  children: ReactNode; variant?: Variant; color?: string; muted?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number;
}) {
  const c = useColors();
  const { variant = 'body' } = props;
  const color = props.color ?? (props.muted || variant === 'label' ? c.muted : c.text);
  return (
    <Text numberOfLines={props.numberOfLines} style={[VARIANTS[variant], { color }, props.style]}>
      {props.children}
    </Text>
  );
}

/** Figures use tabular digits so columns of amounts line up. */
export function Amount(props: { children: string; color?: string; size?: number; weight?: TextStyle['fontWeight'] }) {
  const c = useColors();
  return (
    <Text style={{ fontSize: props.size ?? 16, fontWeight: props.weight ?? '500', color: props.color ?? c.text, fontVariant: ['tabular-nums'] }}>
      {props.children}
    </Text>
  );
}

// Layout

/**
 * Keeps its contents above the iPhone keyboard. It measures where it sits on screen, so
 * it works under any header and inside sheets. Android resizes the window by itself.
 */
export function KeyboardSpace(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const container = useRef<ComponentRef<typeof View>>(null);
  const [top, setTop] = useState(0);
  if (Platform.OS !== 'ios') return <View style={[{ flex: 1 }, props.style]}>{props.children}</View>;
  return (
    <View ref={container} style={[{ flex: 1 }, props.style]} onLayout={() => container.current?.measureInWindow((_x: number, y: number) => setTop(y))}>
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={top} style={{ flex: 1 }}>
        {props.children}
      </KeyboardAvoidingView>
    </View>
  );
}

export function Screen(props: { children: ReactNode; scroll?: boolean; footer?: ReactNode; padded?: boolean }) {
  const c = useColors();
  const padding = props.padded === false ? 0 : 16;
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardSpace>
        {props.scroll === false ? (
          <View style={{ flex: 1, padding }}>{props.children}</View>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ padding, paddingBottom: props.footer ? 24 : 96, gap: 16 }}>
            {props.children}
          </ScrollView>
        )}
        {props.footer}
      </KeyboardSpace>
    </SafeAreaView>
  );
}

export function Card(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.card, borderRadius: 14, overflow: 'hidden' }, props.style]}>{props.children}</View>;
}

export function Section(props: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      {(props.title || props.action) && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, minHeight: 24 }}>
          <T variant="label">{props.title ?? ''}</T>
          {props.action}
        </View>
      )}
      <Card>{props.children}</Card>
    </View>
  );
}

export function Divider() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginLeft: 16 }} />;
}

/** Children separated by hairlines. */
export function Rows(props: { children: ReactNode[] }) {
  const items = props.children.flat().filter(Boolean);
  return <>{items.map((child, index) => <View key={index}>{index > 0 && <Divider />}{child}</View>)}</>;
}

export function Row(props: {
  title: string; subtitle?: string | null; icon?: IconName; iconColor?: string; right?: ReactNode; value?: string;
  onPress?: () => void; chevron?: boolean; danger?: boolean; dense?: boolean; lines?: number; indent?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!props.onPress}
      accessibilityRole={props.onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 16, paddingLeft: props.indent ? 36 : 16,
        minHeight: props.dense ? 48 : 56, paddingVertical: 8, opacity: pressed ? 0.6 : 1,
      })}>
      {props.icon && <Ionicons name={props.icon} size={22} color={props.iconColor ?? (props.danger ? c.danger : c.accent)} />}
      <View style={{ flex: 1 }}>
        <T color={props.danger ? c.danger : undefined} numberOfLines={1}>{props.title}</T>
        {!!props.subtitle && <T variant="small" muted numberOfLines={props.lines ?? 2}>{props.subtitle}</T>}
      </View>
      {props.value != null && <T muted>{props.value}</T>}
      {props.right}
      {(props.chevron ?? !!props.onPress) && !props.right && <Ionicons name="chevron-forward" size={18} color={c.faint} />}
    </Pressable>
  );
}

export function Empty(props: { icon: IconName; title: string; hint?: string; action?: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', padding: 32, gap: 8 }}>
      <Ionicons name={props.icon} size={40} color={c.faint} />
      <T variant="heading" style={{ textAlign: 'center' }}>{props.title}</T>
      {props.hint && <T muted style={{ textAlign: 'center' }}>{props.hint}</T>}
      {props.action && <View style={{ marginTop: 8 }}>{props.action}</View>}
    </View>
  );
}

export function Notice(props: { children: ReactNode; tone?: 'warn' | 'info' }) {
  const c = useColors();
  const warn = props.tone !== 'info';
  return (
    <View style={{ backgroundColor: warn ? c.warnSoft : c.accentSoft, borderRadius: 12, padding: 12 }}>
      <T variant="small" color={warn ? c.warn : c.text}>{props.children}</T>
    </View>
  );
}

// Controls

export function Button(props: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'plain'; icon?: IconName;
  disabled?: boolean; small?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const { kind = 'primary' } = props;
  const background = kind === 'primary' ? c.accent : kind === 'plain' ? 'transparent' : c.card;
  const color = kind === 'primary' ? c.onAccent : kind === 'danger' ? c.danger : c.accent;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: background,
          minHeight: props.small ? 36 : 48, paddingHorizontal: props.small ? 12 : 18, borderRadius: 12,
          borderWidth: kind === 'secondary' || kind === 'danger' ? StyleSheet.hairlineWidth : 0, borderColor: c.line,
          opacity: props.disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        props.style,
      ]}>
      {props.icon && <Ionicons name={props.icon} size={18} color={color} />}
      <Text style={{ color, fontSize: props.small ? 14 : 16, fontWeight: '600' }}>{props.title}</Text>
    </Pressable>
  );
}

export function IconButton(props: { icon: IconName; onPress: () => void; label: string; color?: string; size?: number }) {
  const c = useColors();
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={8}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
      <Ionicons name={props.icon} size={props.size ?? 24} color={props.color ?? c.accent} />
    </Pressable>
  );
}

export function Chip(props: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName; onRemove?: () => void }) {
  const c = useColors();
  const color = props.selected ? c.onAccent : c.text;
  return (
    <Pressable
      onPress={props.onPress ?? props.onRemove}
      accessibilityRole="button"
      accessibilityState={{ selected: !!props.selected }}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 36, borderRadius: 18,
        backgroundColor: props.selected ? c.accent : c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: props.selected ? c.accent : c.line,
      }}>
      {props.icon && <Ionicons name={props.icon} size={16} color={color} />}
      <Text style={{ color, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>{props.label}</Text>
      {props.onRemove && <Ionicons name="close" size={16} color={color} />}
    </Pressable>
  );
}

export function ChipRow(props: { children: ReactNode; wrap?: boolean }) {
  if (props.wrap) return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{props.children}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
      {props.children}
    </ScrollView>
  );
}

export function Segmented<V extends string>(props: { options: { value: V; label: string }[]; value: V; onChange: (value: V) => void }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.line, borderRadius: 10, padding: 2 }}>
      {props.options.map((option) => {
        const selected = option.value === props.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => props.onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{ flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: selected ? c.card : 'transparent' }}>
            <Text style={{ color: c.text, fontSize: 14, fontWeight: selected ? '600' : '400' }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field(props: TextInputProps & { label: string; hint?: string; right?: ReactNode }) {
  const c = useColors();
  const { label, hint, right, style, ...input } = props;
  return (
    <View style={{ gap: 6 }}>
      <T variant="label">{label}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line }}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={c.faint}
          {...input}
          style={[{ flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: c.text }, style]}
        />
        {right}
      </View>
      {hint && <T variant="small" muted>{hint}</T>}
    </View>
  );
}

/** A labelled row that opens a picker. */
export function Choice(props: { label: string; value: string | null; placeholder?: string; onPress: () => void; icon?: IconName }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <T variant="label">{props.label}</T>
      <Pressable
        onPress={props.onPress}
        accessibilityRole="button"
        accessibilityLabel={`${props.label}: ${props.value ?? props.placeholder ?? 'none'}`}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderRadius: 12, minHeight: 48,
          paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line,
        }}>
        {props.icon && <Ionicons name={props.icon} size={18} color={c.muted} />}
        <T style={{ flex: 1 }} color={props.value ? c.text : c.faint} numberOfLines={1}>{props.value ?? props.placeholder ?? 'Choose'}</T>
        <Ionicons name="chevron-down" size={18} color={c.faint} />
      </Pressable>
    </View>
  );
}

export function Toggle(props: { title: string; subtitle?: string; value: boolean; onChange: (value: boolean) => void }) {
  const c = useColors();
  return (
    <Row
      title={props.title}
      subtitle={props.subtitle}
      onPress={() => props.onChange(!props.value)}
      right={<Ionicons name={props.value ? 'checkbox' : 'square-outline'} size={24} color={props.value ? c.accent : c.faint} />}
    />
  );
}

// Sheets

/** A panel that slides up over the page for a short task. */
export function Sheet(props: { visible: boolean; onClose: () => void; title: string; children: ReactNode; action?: ReactNode }) {
  const c = useColors();
  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={props.onClose} accessibilityLabel="Close" />
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: c.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '88%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 8, paddingTop: 8 }}>
            <T variant="heading" style={{ flex: 1 }}>{props.title}</T>
            {props.action}
            <IconButton icon="close" label="Close" onPress={props.onClose} color={c.muted} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 14 }}>
            {props.children}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface Option<V> {
  value: V;
  label: string;
  detail?: string;
  /** Shown as a heading above this option. */
  heading?: string;
  indent?: boolean;
}

/** A sheet listing options to choose one from. */
export function PickerSheet<V extends string | number | null>(props: {
  visible: boolean; onClose: () => void; title: string; options: Option<V>[]; value?: V; onPick: (value: V) => void;
}) {
  const c = useColors();
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={props.title}>
      {props.options.length === 0 && <T muted>Nothing to choose from yet.</T>}
      <View>
        {props.options.map((option, index) => (
          <View key={String(option.value)}>
            {option.heading && <T variant="label" style={{ marginTop: index ? 14 : 0, marginBottom: 6, marginLeft: 4 }}>{option.heading}</T>}
            <Pressable
              onPress={() => {
                props.onPick(option.value);
                props.onClose();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: option.value === props.value }}
              style={{
                flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 14, marginBottom: 2,
                paddingLeft: option.indent ? 32 : 14, borderRadius: 10, backgroundColor: c.card,
              }}>
              <T style={{ flex: 1 }} numberOfLines={1}>{option.label}</T>
              {option.detail && <T muted variant="small">{option.detail}</T>}
              {option.value === props.value && <Ionicons name="checkmark" size={20} color={c.accent} style={{ marginLeft: 8 }} />}
            </Pressable>
          </View>
        ))}
      </View>
    </Sheet>
  );
}

// Dialogs

/** Shows a problem in words. Ledger problems are written for people; others are not. */
export function showError(error: unknown) {
  const message = error instanceof LedgerError || (error instanceof Error && error.name !== 'TypeError') ? (error as Error).message : 'Something went wrong. Nothing was changed.';
  if (Platform.OS === 'web') window.alert(message);
  else Alert.alert('', message);
  if (!(error instanceof LedgerError)) console.warn(error);
}

/** Runs something that may be refused; returns true if it went through. */
export function attempt(work: () => void): boolean {
  try {
    work();
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}

export function confirm(title: string, message: string, action: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);
}
