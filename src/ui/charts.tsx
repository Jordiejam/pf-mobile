import { type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';
import { T } from './kit';
import { useColors } from './theme';

/** A ring divided in proportion to its slices, with something in the middle. */
export function Donut(props: { slices: { value: number; color: string }[]; size?: number; children?: ReactNode }) {
  const c = useColors();
  const size = props.size ?? 180;
  const stroke = 26;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const slices = props.slices.filter((slice) => slice.value > 0);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let offset = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="image">
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={c.line} strokeWidth={stroke} fill="none" />
        {slices.map((slice, index) => {
          const length = (slice.value / total) * circumference;
          const circle = (
            <Circle
              key={index} cx={size / 2} cy={size / 2} r={radius} stroke={slice.color} strokeWidth={stroke} fill="none"
              strokeDasharray={`${Math.max(length - 1.5, 0.5)} ${circumference}`} strokeDashoffset={-offset}
            />
          );
          offset += length;
          return circle;
        })}
      </Svg>
      {props.children}
    </View>
  );
}

/** Bars for a run of periods, one or two series each; pressing one selects it. */
export function Bars(props: {
  data: { label: string; values: number[] }[]; colors: string[]; height?: number; selected?: number; onSelect?: (index: number) => void;
}) {
  const c = useColors();
  const height = props.height ?? 120;
  const max = Math.max(1, ...props.data.flatMap((item) => item.values));
  const series = props.colors.length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
      {props.data.map((item, index) => (
        <Pressable
          key={index}
          onPress={() => props.onSelect?.(index)}
          disabled={!props.onSelect}
          accessibilityRole={props.onSelect ? 'button' : undefined}
          accessibilityLabel={item.label}
          style={{ flex: 1, alignItems: 'center', gap: 4, opacity: props.selected == null || props.selected === index ? 1 : 0.45 }}>
          <Svg width="100%" height={height}>
            {item.values.map((value, position) => {
              const barHeight = Math.max((Math.max(value, 0) / max) * (height - 4), value > 0 ? 2 : 0);
              const width = 100 / series;
              return (
                <Rect
                  key={position} x={`${position * width + width * 0.12}%`} width={`${width * 0.76}%`}
                  y={height - barHeight} height={barHeight} rx={3} fill={props.colors[position]}
                />
              );
            })}
            <Line x1="0" x2="100%" y1={height - 0.5} y2={height - 0.5} stroke={c.line} strokeWidth={1} />
          </Svg>
          <T variant="small" muted numberOfLines={1}>{item.label}</T>
        </Pressable>
      ))}
    </View>
  );
}

/** A line through values over time, scaled to fit, with a baseline at zero when in range. */
export function LineChart(props: { values: number[]; color: string; height?: number }) {
  const c = useColors();
  const height = props.height ?? 140;
  const width = 300;
  const { values } = props;
  if (values.length < 2) return <View style={{ height }} />;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low || Math.abs(high) || 1) * 0.1;
  const [bottom, top] = [low - pad, high + pad];
  const x = (index: number) => (index / (values.length - 1)) * width;
  const y = (value: number) => height - ((value - bottom) / (top - bottom)) * height;
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" accessibilityRole="image">
      {bottom < 0 && top > 0 && <Line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={c.line} strokeWidth={1} />}
      <Path d={`M0,${height} L${points.replace(/ /g, ' L')} L${width},${height} Z`} fill={props.color} opacity={0.12} />
      <Polyline points={points} fill="none" stroke={props.color} strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </Svg>
  );
}
