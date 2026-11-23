import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCustomStage,
  CustomStageShelf,
  decodeSettings,
  DEFAULT_SETTINGS,
  encodeSettings,
  normalizeSettings,
  settingsFromHash,
  shareLink,
} from '../src/game/customStage';
import { BridgeDesign } from '../src/game/design';

function fakeStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe('ステージ作成', () => {
  it('決めた条件のステージを作れる。道路より上に組めないときは、上に節点を置けない', () => {
    const stage = buildCustomStage({
      id: 'custom-1',
      settings: { ...DEFAULT_SETTINGS, span: 24, vehicleId: 'bus', vehicleCount: 2, belowRoadOnly: true, lowAnchors: true },
    });
    expect(stage.span).toBe(24);
    expect(stage.goal).toBe('バス 2 台を、予算の中でわたらせよう');
    expect(stage.anchors).toHaveLength(4);
    expect(new BridgeDesign(stage).canPlaceNode(4, 2)).toBe(false);
    expect(new BridgeDesign(stage).canPlaceNode(4, -2)).toBe(true);
  });

  it('リンクに入れた条件を、そのまま読みもどせる（日本語の名前も）', () => {
    const settings = { ...DEFAULT_SETTINGS, title: '3年1組の谷', materials: ['wood' as const, 'wire' as const] };
    expect(decodeSettings(encodeSettings(settings))).toEqual(settings);

    const link = shareLink(settings, 'https://example.com/bridge-simulator/?a=1');
    expect(settingsFromHash(new URL(link).hash)).toEqual(settings);
    expect(settingsFromHash('#other')).toBeNull();
    expect(decodeSettings('こわれたリンク')).toBeNull();
  });

  it('書きかえられたリンクでも、遊べる条件に直す', () => {
    const fixed = normalizeSettings({
      ...DEFAULT_SETTINGS,
      title: 'とても長い名前とても長い名前とても長い名前',
      budget: 99_999_999,
      vehicleCount: 50,
      materials: ['wire', 'gold'],
    });
    expect(fixed?.title).toHaveLength(20);
    expect(fixed?.budget).toBe(300_000);
    expect(fixed?.vehicleCount).toBe(3);
    // ワイヤーだけでは道路が作れないので、木材を足す
    expect(fixed?.materials).toEqual(['wood', 'wire']);

    expect(normalizeSettings({ ...DEFAULT_SETTINGS, span: 15 })).toBeNull();
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, vehicleId: 'rocket' })).toBeNull();
    expect(normalizeSettings('ステージ')).toBeNull();
  });

  describe('端末に覚えておく', () => {
    beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));
    afterEach(() => vi.unstubAllGlobals());

    it('入れたステージは開きなおしても残り、同じリンクを 2 回開いても 1 つだけ', () => {
      const shelf = new CustomStageShelf();
      const first = shelf.add(DEFAULT_SETTINGS);
      expect(shelf.add({ ...DEFAULT_SETTINGS }).id).toBe(first.id);

      shelf.update(first.id, { ...DEFAULT_SETTINGS, budget: 40_000 });
      expect(new CustomStageShelf().entries).toEqual([{ id: first.id, settings: { ...DEFAULT_SETTINGS, budget: 40_000 } }]);

      shelf.remove(first.id);
      expect(new CustomStageShelf().entries).toEqual([]);
    });
  });
});
