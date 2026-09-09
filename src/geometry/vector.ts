import type { Point } from '../types.js';

export const EPSILON = 1e-9;

export function point(x = 0, y = 0): Point {
  return { x, y };
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function multiply(a: Point, scalar: number): Point {
  return { x: a.x * scalar, y: a.y * scalar };
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

export function magnitudeSquared(value: Point): number {
  return dot(value, value);
}

export function magnitude(value: Point): number {
  return Math.hypot(value.x, value.y);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalize(value: Point): Point {
  const length = magnitude(value);
  return length < EPSILON ? { x: 0, y: 0 } : multiply(value, 1 / length);
}

export function perpendicular(value: Point): Point {
  return { x: -value.y, y: value.x };
}

export function lerp(a: Point, b: Point, amount: number): Point {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
  };
}

export function midpoint(a: Point, b: Point): Point {
  return lerp(a, b, 0.5);
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function snap(value: number, spacing: number): number {
  return spacing <= 0 ? value : Math.round(value / spacing) * spacing;
}

export function snapPoint(value: Point, spacing: number): Point {
  return { x: snap(value.x, spacing), y: snap(value.y, spacing) };
}

export function almostEqual(a: number, b: number, epsilon = EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function pointsEqual(a: Point, b: Point, epsilon = EPSILON): boolean {
  return almostEqual(a.x, b.x, epsilon) && almostEqual(a.y, b.y, epsilon);
}

export function isAxisAligned(a: Point, b: Point, epsilon = EPSILON): boolean {
  return almostEqual(a.x, b.x, epsilon) || almostEqual(a.y, b.y, epsilon);
}

export function projectPointToSegment(value: Point, start: Point, end: Point): Point {
  const segment = subtract(end, start);
  const denominator = magnitudeSquared(segment);
  if (denominator < EPSILON) return { ...start };
  const amount = clamp(dot(subtract(value, start), segment) / denominator, 0, 1);
  return add(start, multiply(segment, amount));
}

export function distancePointToSegment(value: Point, start: Point, end: Point): number {
  return distance(value, projectPointToSegment(value, start, end));
}

export function angleDegrees(start: Point, end: Point): number {
  return (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
}

export function roundPoint(value: Point, decimalPlaces = 3): Point {
  const factor = 10 ** decimalPlaces;
  return {
    x: Math.round(value.x * factor) / factor,
    y: Math.round(value.y * factor) / factor,
  };
}
