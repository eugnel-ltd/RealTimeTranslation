import { describe, expect, it } from 'vitest';
import {
  applyTemplateDefaults,
  DEFAULT_SESSION_TEMPLATE_ID,
  getSessionTemplate,
  isSessionTemplateId,
  SESSION_TEMPLATES,
} from '../shared/sessionTemplates';

describe('session templates', () => {
  it('has a stable id for every preset including one-way AI video', () => {
    const ids = SESSION_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual([
      'interview-screening',
      'interview-ai-timed',
      'interview-competency',
      'interview-oneway-video',
      'meeting',
    ]);
    expect(DEFAULT_SESSION_TEMPLATE_ID).toBe('interview-competency');
    expect(isSessionTemplateId('nope')).toBe(false);
    expect(getSessionTemplate('nope').id).toBe('interview-competency');
  });

  it('keeps one-way video distinct from generic AI / timed', () => {
    const timed = getSessionTemplate('interview-ai-timed');
    const oneway = getSessionTemplate('interview-oneway-video');
    expect(oneway.timer.defaultSeconds).toBe(180);
    expect(oneway.timer.prepDefaultSeconds).toBe(30);
    expect(oneway.prominentManualInput).toBe(true);
    expect(oneway.prompt.answerShape).toMatch(/250–330/);
    expect(oneway.prompt.role).toMatch(/HireVue/);
    expect(timed.timer.defaultSeconds).toBe(120);
    expect(timed.timer.prepDefaultSeconds).toBe(0);
    expect(timed.timer.prepOptions).toEqual([0]);
    expect(timed.prominentManualInput).toBe(false);
    expect(timed.prompt.answerShape).not.toMatch(/250–330/);
  });

  it('applies meeting and oneway UI defaults', () => {
    expect(applyTemplateDefaults('meeting').autoDetect).toBe(false);
    expect(applyTemplateDefaults('interview-oneway-video')).toMatchObject({
      sessionTemplateId: 'interview-oneway-video',
      questionTimerSeconds: 180,
      prepTimerSeconds: 30,
      autoDetect: true,
    });
  });
});
