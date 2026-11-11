import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { clampedDate, dayKey, daysInMonth, monthName, timeLabel } from '@/core';
import { Button, IconButton, Sheet, T } from './kit';
import { useColors } from './theme';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** A month grid for choosing a day, with an optional time of day. */
export function DateSheet(props: { visible: boolean; onClose: () => void; value: Date; onChange: (value: Date) => void; time?: boolean; title?: string }) {
  const c = useColors();
  const [shown, setShown] = useState(() => new Date(props.value.getFullYear(), props.value.getMonth(), 1));
  const [time, setTime] = useState(() => timeLabel(props.value));
  const [year, month] = [shown.getFullYear(), shown.getMonth()];
  const blanks = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells = [...Array(blanks).fill(null), ...Array.from({ length: daysInMonth(year, month) }, (_, index) => index + 1)];
  const selected = dayKey(props.value);
  const today = dayKey(new Date());

  const withTime = (date: Date) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    const [hours, minutes] = match && Number(match[1]) < 24 && Number(match[2]) < 60 ? [Number(match[1]), Number(match[2])] : [12, 0];
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
  };

  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={props.title ?? 'Date'}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconButton icon="chevron-back" label="Previous month" onPress={() => setShown(clampedDate(year, month - 1, 1))} />
        <T variant="heading" style={{ flex: 1, textAlign: 'center' }}>{monthName(month)} {year}</T>
        <IconButton icon="chevron-forward" label="Next month" onPress={() => setShown(clampedDate(year, month + 1, 1))} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {WEEKDAYS.map((day, index) => (
          <View key={index} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingBottom: 4 }}>
            <T variant="small" muted>{day}</T>
          </View>
        ))}
        {cells.map((day, index) => {
          const key = day ? dayKey(new Date(year, month, day)) : '';
          const isSelected = key === selected;
          return (
            <View key={index} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 }}>
              {day && (
                <Pressable
                  onPress={() => props.onChange(withTime(new Date(year, month, day)))}
                  accessibilityRole="button"
                  accessibilityLabel={`${day} ${monthName(month)} ${year}`}
                  accessibilityState={{ selected: isSelected }}
                  style={{
                    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: isSelected ? c.accent : 'transparent', borderWidth: key === today && !isSelected ? 1 : 0, borderColor: c.accent,
                  }}>
                  <T color={isSelected ? c.onAccent : c.text}>{day}</T>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
      {props.time && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <T muted>Time</T>
          <TextInput
            value={time}
            onChangeText={setTime}
            onEndEditing={() => props.onChange(withTime(props.value))}
            placeholder="12:00"
            placeholderTextColor={c.faint}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Time, as hours and minutes"
            style={{ backgroundColor: c.card, color: c.text, borderRadius: 10, paddingHorizontal: 14, minHeight: 44, fontSize: 16, minWidth: 90 }}
          />
        </View>
      )}
      <Button
        title="Done"
        onPress={() => {
          props.onChange(withTime(props.value));
          props.onClose();
        }}
      />
    </Sheet>
  );
}
