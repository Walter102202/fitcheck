import { describe, expect, it } from 'vitest';
import { type ChecklistData, loadChecklist } from './index.js';

const lists: [string, ChecklistData][] = (['common', 'tv', 'hair_dryer'] as const).map((c) => [
  c,
  loadChecklist(c),
]);

describe('checklists', () => {
  it.each(lists)('%s: every fact has a label', (_, list) => {
    for (const [fact, value] of Object.entries(list.facts)) {
      const label = (value as { label?: unknown }).label;
      expect(typeof label === 'string' && label.length > 0, fact).toBe(true);
    }
  });

  // Reason templates are shown after "Sent to the agent:", so they speak about the buyer.
  it.each(lists)('%s: reason templates never address the buyer as "you"', (_, list) => {
    const templates = [...JSON.stringify(list).matchAll(/"reasonTemplate":"([^"]*)"/g)].map(
      (m) => m[1] ?? '',
    );
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) expect(template).not.toMatch(/\byou\b/i);
  });

  it('the dual-voltage reason tells the agent what to pick instead', () => {
    expect(JSON.stringify(loadChecklist('hair_dryer'))).toContain(
      '"reasonTemplate":"The listing says it only works on 110-120 V outlets; the buyer is taking it abroad. Pick an offer whose listing states 220-240 V or dual voltage."',
    );
  });

  it('requirement ids are unique across the three files', () => {
    const ids = lists.flatMap(([, list]) => list.requirements.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tv.* ids live in tv.json and hair_dryer.* ids in hair_dryer.json', () => {
    for (const [name, list] of lists) {
      for (const { id } of list.requirements) {
        if (id.startsWith('tv.')) expect(name).toBe('tv');
        if (id.startsWith('hair_dryer.')) expect(name).toBe('hair_dryer');
      }
    }
  });

  it.each(lists)('%s: every question line ends with a question mark', (_, list) => {
    for (const requirement of list.requirements) {
      const line = (requirement.line ?? {}) as Record<string, string>;
      for (const [type, text] of Object.entries(line)) {
        expect(text.trimEnd().endsWith('?'), `${requirement.id} ${type}`).toBe(true);
      }
    }
  });

  it('only common requirements apply always', () => {
    for (const [name, list] of lists) {
      if (name === 'common') continue;
      for (const requirement of list.requirements) {
        const appliesWhen = requirement.appliesWhen as { always?: unknown } | null;
        expect(appliesWhen?.always === true, requirement.id).toBe(false);
      }
    }
  });

  it('tv.json leaves picture formats and gaming out', () => {
    const ids = loadChecklist('tv').requirements.map((r) => r.id);
    for (const dropped of ['tv.dolby_vision', 'tv.hdr10_plus', 'tv.console_120hz']) {
      expect(ids).not.toContain(dropped);
    }
  });
});
