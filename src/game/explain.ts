import type { CrossingOutcome } from '../engine/crossing';
import type { FailureMode } from '../engine/types';
import { utilizationPercent } from './score';

export interface Explanation {
  title: string;
  body: string;
  hints: string[];
}

const FAILURE_TEXT: Record<FailureMode, Explanation> = {
  tension: {
    title: '部材が引っぱられて切れてしまった',
    body: '青い部材は両はしから引っぱられています。材料の強さをこえる力で引っぱられると、部材は切れます。',
    hints: ['切れた部材を、強い材料や太い断面にする', '同じ向きに部材を増やして、力を分け合う'],
  },
  compression: {
    title: '部材が押しつぶされてしまった',
    body: '赤い部材は両はしから押されています。材料の強さをこえる力で押されると、部材はつぶれます。',
    hints: ['つぶれた部材を、強い材料や太い断面にする', '橋の高さを上げて、上と下の部材にかかる力を小さくする'],
  },
  buckling: {
    title: '部材が押されて曲がってしまった（座屈）',
    body: '細長い部材を両はしから押すと、ある力をこえたとき急に横へ曲がります。これを「座屈（ざくつ）」といいます。長い部材ほど、小さな力で曲がります。',
    hints: ['部材を短くする（間に節点を入れる）', '赤くなった部材だけ曲がりにくい断面にする', '橋の高さを上げて、押す力を小さくする'],
  },
  bending: {
    title: '部材が曲げられて折れてしまった',
    body: '剛接合の部材は、曲げる力も受けます。曲げる力が大きすぎると、部材は折れます。',
    hints: ['斜めの部材を入れて三角形を作り、曲げる力を軸の力に変える', '曲がりにくい断面（H形など）にする'],
  },
};

/** 試験の結果を、生徒に見せる言葉にする */
export function explainOutcome(outcome: CrossingOutcome, options: { allowRigidJoints: boolean }): Explanation {
  const percent = utilizationPercent(outcome.maxUtilization);

  switch (outcome.status) {
    case 'crossed':
      return {
        title: 'わたり切りました！',
        body: `いちばん苦しかった部材の負担率は ${percent}% でした。`,
        hints:
          percent > 70
            ? ['安全の目安は 70% 以下。赤や青がこい部材を強くしてみよう']
            : ['余裕があります。部材をへらして、もっと安くできるかな？'],
      };
    case 'unstable':
      return {
        title: '橋の形がくずれてしまった',
        body:
          '赤い丸の節点のまわりは、支える部材が足りず、ぐにゃりと動いてしまいます。' +
          'ピン接合の四角形や、1 本だけでぶら下がった部材は、形を保てません。',
        hints: [
          '赤い丸の節点から岸やほかの節点へ部材をつなぎ、三角形を作る',
          ...(options.allowRigidJoints ? ['角を「剛接合」にする（ラーメン構造）'] : []),
        ],
      };
    case 'gap':
      return {
        title: '道路がつながっていません',
        body: '車が走る道路（岸と同じ高さの横の部材）が、左の岸から右の岸までつながっていません。',
        hints: ['岸と同じ高さで、左の岸から右の岸まで横の部材をつなげる'],
      };
    case 'collapsed':
      return FAILURE_TEXT[outcome.broken[0]?.mode ?? 'compression'];
  }
}

export function modeLabel(axial: number): string {
  return axial >= 0 ? '引っぱられている（引張）' : '押されている（圧縮）';
}
