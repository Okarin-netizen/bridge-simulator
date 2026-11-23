import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWork, saveWork } from '../src/game/savedWork';

function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe('ステージごとの橋と振り返りを覚えておく', () => {
  afterEach(() => vi.unstubAllGlobals());

  describe('ふつうに保存できるとき', () => {
    beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));

    it('保存したものをステージごとに読み出せる', () => {
      const bridge = { nodes: [{ id: 'n1', x: 4, y: 0, joint: 'pin' as const }], members: [] };
      saveWork('1-1', { bridge, reflection: '三角形にしたら負担率が下がった' });
      saveWork('1-2', { bridge: { nodes: [], members: [] }, reflection: '' });

      expect(loadWork('1-1')).toEqual({ bridge, reflection: '三角形にしたら負担率が下がった' });
      expect(loadWork('1-2')?.reflection).toBe('');
      expect(loadWork('2-1')).toBeUndefined();
    });
  });

  it('保存した中身がこわれていたら、何もなかったことにする', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'kakehashi-lab:work': '{"1-1":{"bridge":{"nodes":3}}}' }));
    expect(loadWork('1-1')).toBeUndefined();

    vi.stubGlobal('localStorage', fakeStorage({ 'kakehashi-lab:work': 'こわれた文字' }));
    expect(loadWork('1-1')).toBeUndefined();
  });

  it('保存できない環境でも止まらない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => saveWork('1-1', { bridge: { nodes: [], members: [] }, reflection: '' })).not.toThrow();
  });
});
