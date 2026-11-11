import type { Category, Intent, ProductRecord } from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import { getChecklist } from './checklist.js';
import { appliesTo, evaluateRequirement } from './evaluate.js';
import { contextFor } from './paths.js';
import { intentFor, recordedProduct, withProduct } from './testing.js';

type Parts = Parameters<typeof intentFor>[2];

const WALL = { triggered: { 'tv.wall_mount': { quote: 'wall' } } };
const CABINET = { triggered: { 'tv.fits_space': { quote: 'cabinet' } } };
const TRAVEL = { triggered: { 'hair_dryer.dual_voltage': { quote: 'trip to Spain' } } };
const CURLY = { triggered: { 'hair_dryer.diffuser': { quote: 'curly' } } };

function categoryOf(id: string): Category {
  return id.startsWith('hair_dryer.') ? 'hair_dryer' : 'tv';
}

function evalReq(
  reqId: string,
  product: string | ProductRecord,
  domain: string,
  parts: Parts = {},
  category: Category = categoryOf(reqId),
) {
  const checklist = getChecklist(category);
  const req = checklist.requirements.find((r) => r.id === reqId);
  if (!req) throw new Error(`no ${reqId}`);
  const record = typeof product === 'string' ? recordedProduct(product) : product;
  const intent: Intent = intentFor(category, 'request', parts);
  return evaluateRequirement(req, intent, checklist, contextFor(record.product, domain));
}

describe('evaluateRequirement: screen size, resolution, panel', () => {
  it('stated 65 on the Sony is contradictory', () => {
    const e = evalReq('tv.screen_size', 'UXXAg59', 'pcrichard.com', {
      stated: { 'tv.screen_size': { value: 65, quote: '65-inch' } },
    });
    expect(e.result.state).toBe('contradictory');
    expect(e.result.evidence.map((x) => x.value)).toEqual([65, 55]);
    expect(e.line).toEqual({
      lineId: 'tv.screen_size=55|65',
      requirement: 'tv.screen_size',
      type: 'contradictory',
      text: 'The listing gives two screen sizes: 65 inches (title) and 55 inches (features). Is that OK?',
    });
    expect(e.result.fact).toBe('screen size');
    expect(e.result).toMatchObject({ origin: 'stated', originQuote: '65-inch' });
    expect(e.result).not.toHaveProperty('searched');
  });

  it('stated 65 on the Panasonic is backed', () => {
    const e = evalReq('tv.screen_size', '0gH7IUm', 'beachcamera.com', {
      stated: { 'tv.screen_size': { value: 65, quote: '65-inch' } },
    });
    expect(e.result.state).toBe('backed');
    expect(e.line).toBeUndefined();
    expect(e.returnReason).toBeUndefined();
  });

  it('stated 65 on the Samsung S85F with an 83-inch variant is contradictory', () => {
    const e = evalReq('tv.screen_size', '3KRsP5G', 'crutchfield.com', {
      stated: { 'tv.screen_size': { value: 65, quote: '65-inch' } },
    });
    expect(e.result.state).toBe('contradictory');
    expect(e.result.evidence.map((x) => x.value)).toEqual(expect.arrayContaining([83, 65]));
  });

  it('stated 55 on a 65-inch-only TV is broken', () => {
    const e = evalReq('tv.screen_size', '0gH7IUm', 'beachcamera.com', {
      stated: { 'tv.screen_size': { value: 55, quote: '55-inch' } },
    });
    expect(e.result.state).toBe('broken');
    expect(e.returnReason).toBe('It is a 65-inch TV; you asked for 55 inches.');
    expect(e.returnType).toBe('broken');
  });

  it('stated 4K on a TV that also lists 1920 x 1080 is backed', () => {
    const e = evalReq('tv.resolution', 'ENqcYcj', 'bestbuy.com', {
      stated: { 'tv.resolution': { value: '4k', quote: '4K' } },
    });
    expect(e.result.state).toBe('backed');
  });

  it('stated 8K on a 4K TV is broken', () => {
    const e = evalReq('tv.resolution', 'ENqcYcj', 'bestbuy.com', {
      stated: { 'tv.resolution': { value: '8k', quote: '8K' } },
    });
    expect(e.result.state).toBe('broken');
    expect(e.returnReason).toBe('It is 4K; you asked for 8K.');
  });

  it('stated OLED on the Panasonic QLED is broken', () => {
    const e = evalReq('tv.panel_type', '0gH7IUm', 'beachcamera.com', {
      stated: { 'tv.panel_type': { value: 'oled', quote: 'OLED' } },
    });
    expect(e.result.state).toBe('broken');
    expect(e.returnReason).toBe('It is an LED/LCD TV; you asked for OLED.');
  });
});

describe('evaluateRequirement: wall mount and space', () => {
  it('wall request on the Panasonic asks about VESA 300 x 300', () => {
    const e = evalReq('tv.wall_mount', '0gH7IUm', 'beachcamera.com', WALL);
    expect(e.result.state).toBe('never_asked');
    expect(e.result).toMatchObject({ origin: 'triggered', originQuote: 'wall' });
    expect(e.line?.lineId).toBe('tv.wall_mount=300x300');
    expect(e.line?.text).toBe(
      'This TV uses the VESA 300 x 300 mm wall-mount pattern (the hole spacing on its back). Does your mount support it?',
    );
    expect(e.result.evidence[0]).toMatchObject({
      path: 'structured_attributes.vesa-mounting-pattern',
      display: '300 x 300 mm',
    });
  });

  it('wall request on the Samsung S90F gives a contradictory VESA line', () => {
    const e = evalReq('tv.wall_mount', 'JsWPLPk', 'bestbuy.com', WALL);
    expect(e.result.state).toBe('contradictory');
    expect(e.line?.lineId).toBe('tv.wall_mount=100x200|400x200');
    expect(e.line?.text).toBe(
      'The listing gives two wall-mount patterns: 400 x 200 mm (attribute) and 100 x 200 mm (attribute). Is that OK?',
    );
  });

  it('wall request on a listing without VESA is unbacked', () => {
    const e = evalReq('tv.wall_mount', '7ZfAuSE', 'qvc.com', WALL);
    expect(e.line).toEqual({
      lineId: 'tv.wall_mount',
      requirement: 'tv.wall_mount',
      type: 'unbacked',
      text: 'The listing does not give the wall-mount pattern (VESA). Is that OK?',
    });
    expect(e.result).toMatchObject({
      state: 'unbacked',
      evidence: [],
      searched: ['Attribute: vesa-mounting-pattern'],
      fact: 'wall-mount pattern',
    });
  });

  it('a stated mount up to 400 x 400 backs both patterns of the S90F', () => {
    const e = evalReq('tv.wall_mount', 'JsWPLPk', 'bestbuy.com', {
      stated: { 'tv.wall_mount': { value: '400x400', quote: 'up to 400 x 400' } },
    });
    expect(e.result.state).toBe('backed');
    expect(e.result.origin).toBe('stated');
    expect(e.result.evidence.map((x) => x.value)).toEqual(['400x200', '100x200']);
  });

  it('a stated mount up to 200 x 200 on the S90F is contradictory', () => {
    const e = evalReq('tv.wall_mount', 'JsWPLPk', 'bestbuy.com', {
      stated: { 'tv.wall_mount': { value: '200x200', quote: 'up to 200 x 200' } },
    });
    expect(e.result.state).toBe('contradictory');
    expect(e.line?.type).toBe('contradictory');
  });

  it('a stated mount up to 200 x 200 on the Panasonic is broken', () => {
    const e = evalReq('tv.wall_mount', '0gH7IUm', 'beachcamera.com', {
      stated: { 'tv.wall_mount': { value: '200x200', quote: 'up to 200 x 200' } },
    });
    expect(e.result.state).toBe('broken');
    expect(e.returnReason).toBe(
      'This TV uses the VESA 300 x 300 mm pattern; your mount takes up to 200 x 200 mm.',
    );
  });

  it('cabinet request on the TCL S4 asks about its 56.9-inch width', () => {
    const e = evalReq('tv.fits_space', 'giXv9lz', 'rcwilley.com', CABINET);
    expect(e.result.state).toBe('never_asked');
    expect(e.line?.text).toBe(
      'This TV is 56.9 inches wide. Is there room for that in the spot it goes?',
    );
    expect(e.line?.lineId).toBe('tv.fits_space=56.9');
    expect(e.result.fact).toBe('width');
  });

  it('a stated width narrower than the TV is broken', () => {
    const e = evalReq('tv.fits_space', 'giXv9lz', 'rcwilley.com', {
      stated: { 'tv.fits_space': { value: 50, quote: '50 inches' } },
    });
    expect(e.result.state).toBe('broken');
    expect(e.returnReason).toBe('This TV is 56.9 inches wide; the spot is 50 inches.');
  });

  it('fits_space does not apply when the wall mount applies', () => {
    const tv = getChecklist('tv');
    const fits = tv.requirements.find((r) => r.id === 'tv.fits_space');
    if (!fits) throw new Error('no fits_space');
    const both = intentFor('tv', 'request', {
      triggered: { 'tv.wall_mount': { quote: 'wall' }, 'tv.fits_space': { quote: 'Replace' } },
    });
    expect(appliesTo(fits, both, null).applies).toBe(false);
    expect(appliesTo(fits, intentFor('tv', 'request', CABINET), null)).toEqual({
      applies: true,
      origin: 'triggered',
      originQuote: 'cabinet',
    });
  });

  it('store widths that disagree are contradictory', () => {
    const e = evalReq('tv.fits_space', 'YQfWgKT', 'abt.com', CABINET);
    expect(e.result.state).toBe('contradictory');
    expect(e.line?.text).toBe(
      'The stores give different widths for this TV: 56.7 inches (abt.com), 42.2 inches (beachcamera.com) and 65.4 inches (cityhome.com). Is that OK?',
    );
  });
});

describe('evaluateRequirement: hair dryers', () => {
  it('travel request: the ANIQ is broken from its description', () => {
    const e = evalReq('hair_dryer.dual_voltage', 'cv7t721', 'walmart.com', TRAVEL);
    expect(e.result.state).toBe('broken');
    expect(e.result.evidence[0]).toMatchObject({
      path: 'description',
      label: 'Description',
      text: 'Note: For use with 110V–120V outlets only.',
      value: 'us_only',
      display: '110-120 V only',
    });
    expect(e.returnReason).toBe(
      'The listing says it only works on 110-120 V outlets; you are taking it abroad.',
    );
  });

  it('travel request: the LURA is backed by "Dual Voltage"', () => {
    const e = evalReq('hair_dryer.dual_voltage', 'saZdY6C', 'walmart.com', TRAVEL);
    expect(e.result.state).toBe('backed');
    expect(e.result.evidence[0]?.label).toBe('Features, line 1');
  });

  it('travel request: the Conair 1875 is unbacked', () => {
    const e = evalReq('hair_dryer.dual_voltage', '5swh9aC', 'boscovs.com', TRAVEL);
    expect(e.line).toEqual({
      lineId: 'hair_dryer.dual_voltage',
      requirement: 'hair_dryer.dual_voltage',
      type: 'unbacked',
      text: 'The listing does not say this dryer works on 220-240 V outlets, which Europe and most of the world use. Is that OK?',
    });
    expect(e.result).toMatchObject({
      evidence: [],
      searched: ['Title', 'Features', 'Description'],
      fact: 'voltage',
    });
  });

  it('a backed result carries its fact and no searched', () => {
    const e = evalReq('hair_dryer.dual_voltage', 'saZdY6C', 'walmart.com', TRAVEL);
    expect(e.result.fact).toBe('voltage');
    expect(e.result).not.toHaveProperty('searched');
  });

  it('curly request: the ghd Flight+ is broken although it lists Curly', () => {
    const e = evalReq('hair_dryer.diffuser', 'LRCibGC', 'macys.com', CURLY);
    expect(e.result.state).toBe('broken');
    expect(e.returnReason).toBe('The list of what comes in the box has no diffuser.');
  });

  it('curly request: the O2VOYAGE is contradictory', () => {
    const e = evalReq('hair_dryer.diffuser', 'bC5Wf1F', 'hbbeautybar.com', CURLY);
    expect(e.result.state).toBe('contradictory');
    expect(e.line?.text).toBe(
      'The listing mentions a diffuser, but the list of what comes in the box does not include one. Is that OK?',
    );
    expect(e.line?.lineId).toBe('hair_dryer.diffuser=false|true');
  });

  it('a removed description makes the ANIQ voltage unbacked, not broken', () => {
    const noDescription = withProduct(recordedProduct('cv7t721'), (p) => {
      p.description = null;
    });
    const e = evalReq('hair_dryer.dual_voltage', noDescription, 'walmart.com', TRAVEL);
    expect(e.result.state).toBe('unbacked');
    expect(e.line?.type).toBe('unbacked');
  });
});
