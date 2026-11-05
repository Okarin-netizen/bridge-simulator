import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/game/stage';
import { TEACHER_NOTES } from '../src/teacher/notes';

describe('先生用ページ', () => {
  it('すべてのステージに解説がある', () => {
    const missing = STAGES.filter((stage) => !TEACHER_NOTES[stage.id]).map((stage) => stage.id);
    expect(missing).toEqual([]);
  });
});
