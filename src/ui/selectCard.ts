import { MATERIALS, SECTIONS } from '../engine/materials';
import type { BridgeMember, BridgeNode, JointType, MaterialId, SectionId } from '../engine/types';
import type { BridgeDesign } from '../game/design';
import { memberCost } from '../game/design';
import { RIGID_JOINT_PRICE } from '../game/stage';
import { MATERIAL_COLORS } from './colors';
import { choiceButton } from './dom';
import { yen } from './format';
import { SECTION_ICONS } from './sectionIcons';

/*
 * 置いた部材や節点をタップしたときに、橋の画面の上に出す札。
 * 札の中身を作るだけで、押されたときに橋をどう変えるかは main.ts が決める。
 */

export interface MemberCardActions {
  changeMaterial: (material: MaterialId) => void;
  changeSection: (section: SectionId) => void;
  remove: () => void;
  close: () => void;
}

export interface NodeCardActions {
  changeJoint: (joint: JointType) => void;
  remove: () => void;
  close: () => void;
}

/** 選んだ部材の札：材料と断面をかえる、けす */
export function memberCard(design: BridgeDesign, member: BridgeMember, actions: MemberCardActions): HTMLElement[] {
  const { stage } = design;
  const length = design.lengthOf(member);
  const title = `選んだ部材：${MATERIALS[member.material].name}・${SECTIONS[member.section].name}　長さ ${length.toFixed(1)} m　${yen(memberCost(member, length))}`;

  const rows: HTMLElement[] = [];
  // 1 種類しか選べないステージでは、かえようがないので出さない
  if (stage.materials.length > 1) {
    rows.push(
      optionRow(
        stage.materials.map((id) =>
          choiceButton(
            `<span class="material-swatch" style="background:${MATERIAL_COLORS[id]}"></span>${MATERIALS[id].name}`,
            member.material === id,
            () => actions.changeMaterial(id),
          ),
        ),
      ),
    );
  }
  if (stage.sections.length > 1) {
    rows.push(
      optionRow(
        stage.sections.map((id) =>
          choiceButton(
            `<span class="section-icon">${SECTION_ICONS[id]}</span>${SECTIONS[id].name}`,
            member.section === id,
            () => actions.changeSection(id),
          ),
        ),
      ),
    );
  }

  return [cardTitle(title), ...rows, cardActions('この部材をけす', actions)];
}

/** 選んだ節点の札：ピン接合と剛接合をかえる、けす（支点はけせない） */
export function nodeCard(design: BridgeDesign, node: BridgeNode, actions: NodeCardActions): HTMLElement[] {
  const anchor = design.isAnchor(node);
  const rows: HTMLElement[] = [];
  if (design.stage.allowRigidJoints) {
    rows.push(
      optionRow([
        choiceButton('ピン接合（丸）', node.joint === 'pin', () => actions.changeJoint('pin')),
        choiceButton(`剛接合（四角）${yen(RIGID_JOINT_PRICE)}`, node.joint === 'rigid', () => actions.changeJoint('rigid')),
      ]),
    );
  }
  const title = anchor ? '選んだ支点（支点はけせません）' : '選んだ節点：けすと、つながっている部材もきえます';
  return [cardTitle(title), ...rows, cardActions(anchor ? null : 'この節点をけす', actions)];
}

function cardTitle(text: string): HTMLElement {
  const title = document.createElement('p');
  title.className = 'select-title';
  title.textContent = text;
  return title;
}

function optionRow(buttons: HTMLButtonElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'select-options';
  row.append(...buttons);
  return row;
}

/** 「けす」と「選ぶのをやめる」。removeLabel が null なら、けすボタンは出さない */
function cardActions(removeLabel: string | null, actions: { remove: () => void; close: () => void }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'select-actions';
  if (removeLabel) row.append(choiceButton(removeLabel, false, actions.remove, 'tool danger'));
  row.append(choiceButton('選ぶのをやめる', false, actions.close));
  return row;
}
