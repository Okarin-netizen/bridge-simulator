import type { MaterialId, SectionId } from './types';

export interface Material {
  id: MaterialId;
  name: string;
  /** ヤング率（Pa）：のびにくさ */
  E: number;
  /** 強さ（Pa）：これを超える応力でこわれる */
  strength: number;
  /** 密度（kg/m³） */
  density: number;
  /** 1 m あたりの値段（円）。角材の場合の基準値 */
  pricePerMeter: number;
}

// 実際の材料の値をもとにした代表値。比率（鋼は木の何倍強いかなど）は実物とそろえている。
// ゲームとして遊びやすい尺度への調整は M2 で行う。
export const MATERIALS: Record<MaterialId, Material> = {
  wood: { id: 'wood', name: '木材', E: 8e9, strength: 20e6, density: 450, pricePerMeter: 400 },
  steel: { id: 'steel', name: '鋼材', E: 205e9, strength: 235e6, density: 7850, pricePerMeter: 2500 },
  aluminum: { id: 'aluminum', name: 'アルミ合金', E: 70e9, strength: 150e6, density: 2700, pricePerMeter: 2000 },
};

export interface Section {
  id: SectionId;
  name: string;
  /** 断面積（m²） */
  A: number;
  /** 断面二次モーメント（m⁴）：曲げに対する曲がりにくさ（橋の面の中で曲がる向き） */
  I: number;
  /**
   * いちばん曲がりやすい向きの断面二次モーメント（m⁴）。座屈はこの向きに起きる。
   * 角材とパイプはどの向きも同じだが、H形は横（フランジの面）に曲がりやすい。
   */
  Imin: number;
  /** 断面係数（m³）：曲げに対する強さ */
  Z: number;
  /** 値段の倍率 */
  priceFactor: number;
}

type Shape = Pick<Section, 'A' | 'I' | 'Imin' | 'Z'>;

function square(side: number): Shape {
  const I = side ** 4 / 12;
  return { A: side * side, I, Imin: I, Z: I / (side / 2) };
}

function pipe(outer: number, inner: number): Shape {
  const A = (Math.PI / 4) * (outer ** 2 - inner ** 2);
  const I = (Math.PI / 64) * (outer ** 4 - inner ** 4);
  return { A, I, Imin: I, Z: I / (outer / 2) };
}

function hbeam(width: number, height: number, flange: number, web: number): Shape {
  const A = 2 * width * flange + (height - 2 * flange) * web;
  const I = (width * height ** 3 - (width - web) * (height - 2 * flange) ** 3) / 12;
  // 弱い向き：2 枚のフランジとウェブを、それぞれ横に倒した板として足す
  const Imin = (2 * flange * width ** 3 + (height - 2 * flange) * web ** 3) / 12;
  return { A, I, Imin, Z: I / (height / 2) };
}

// 3 つの断面はほぼ同じ断面積（= ほぼ同じ重さ・材料の量）で、曲がりにくさが違う。
// パイプはどの向きにも曲がりにくいので押される部材に、H形は縦の向きにだけ強いので曲げを受ける梁に向く。
export const SECTIONS: Record<SectionId, Section> = {
  square: { id: 'square', name: '角材', ...square(0.1), priceFactor: 1 },
  pipe: { id: 'pipe', name: 'パイプ', ...pipe(0.2, 0.1651), priceFactor: 1.3 },
  hbeam: { id: 'hbeam', name: 'H形', ...hbeam(0.15, 0.2, 0.02, 0.015), priceFactor: 1.5 },
};

export const GRAVITY = 9.81;
