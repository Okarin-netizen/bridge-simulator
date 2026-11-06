import { describe, expect, it } from 'vitest';
import { forceText, tons } from '../src/ui/format';

describe('数の書き方', () => {
  it('車の重さは、ステージの目標と同じく「11 t」のように書く', () => {
    expect(tons(900)).toBe('0.9 t');
    expect(tons(11000)).toBe('11 t');
  });

  it('力は kN と、同じくらいの物の重さで書く', () => {
    expect(forceText(-4800)).toBe('4.8 kN（およそ 490 kg の物の重さ）');
    expect(forceText(150_000)).toBe('150.0 kN（およそ 15.3 t の物の重さ）');
  });
});
