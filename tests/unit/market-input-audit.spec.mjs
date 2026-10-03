import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let dom;
afterEach(() => dom?.window.close());

function setup(lang = 'ko') {
  dom = new JSDOM(readFileSync(`${lang === 'ko' ? '' : lang + '/'}market.html`, 'utf8'), { url: `https://5ftmag.com/${lang === 'ko' ? '' : lang + '/'}market.html`, runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(readFileSync('js/i18n.js', 'utf8'));
  window.eval(readFileSync('js/util.js', 'utf8'));
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  const create = vi.fn(async () => ({ error: null }));
  const updateMine = vi.fn(async () => ({ error: null }));
  const uploadPhoto = vi.fn();
  window.MagDB = {
    isReady: () => true,
    auth: { getSession: () => new Promise(() => {}) },
    market: { create, updateMine, uploadPhoto, list: async () => [] },
  };
  window.eval(readFileSync('js/market-page.js', 'utf8') + '\nwindow.auditMarket = { parseMarketPrice, renderForm, onSubmit, STATE };');
  window.MagDB.auth.getSession = vi.fn(async () => ({ user: { id: 'seller' } }));
  window.auditMarket.STATE.formPhotos = [{ existingPath: 'seller/photo.jpg', previewUrl: '/photo.jpg' }];
  window.auditMarket.renderForm();
  const form = window.document.getElementById('mktForm');
  const defaultCategory = form.elements.category.value;
  const setPrice = value => { form.elements.price.value = value; form.elements.price.dispatchEvent(new window.Event('input')); };
  const submit = () => window.auditMarket.onSubmit({ preventDefault() {}, target: form });
  Object.assign(form.elements.title, { value: 'Film camera' });
  form.elements.category.value = 'camera';
  form.elements.location.value = 'Seoul';
  form.elements.delivery_method.value = 'courier';
  form.elements.seller_name.value = 'Seller';
  form.elements.contact.value = 'Public seller contact';
  form.elements.safety_agree.checked = true;
  return { window, form, defaultCategory, create, updateMine, uploadPhoto, setPrice, submit, parse: window.auditMarket.parseMarketPrice };
}

describe('R10 market input', () => {
  it.each([
    ['23', 23], ['6', 6], ['230,000', 230000], ['23만원', 230000], ['2.5만원', 25000],
    ['5만원 (택포)', 50000], ['KRW 230,000', 230000], ['250,000 won (shipping incl.)', 250000],
    ['0', 0], ['무료', 0], ['negotiable', null],
  ])('previews %s without guessing a missing unit', (value, amount) => {
    expect(setup().parse(value)).toEqual({ valid: true, amount });
  });

  it.each(['', '-23', '23.5', '23,00', '23abc', '2e5', '$23', '23 / 6', '9007199254740992', 'Infinity'])('rejects malformed or unsafe amount %s', value => {
    expect(setup().parse(value).valid).toBe(false);
  });

  it.each(['ko', 'en', 'ja'])('requires a fresh low-price confirmation in %s', async lang => {
    const { window, form, create, uploadPhoto, setPrice, submit } = setup(lang);
    setPrice('23');
    expect(window.document.getElementById('mktPricePreview').textContent).toMatch(/^23 .*\(KRW\)$/);
    expect(form.elements.low_price_confirm.required).toBe(true);
    await submit();
    expect(create).not.toHaveBeenCalled();
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(form.elements.low_price_confirm.getAttribute('aria-invalid')).toBe('true');
    form.elements.low_price_confirm.checked = true;
    setPrice('6');
    expect(form.elements.low_price_confirm.checked).toBe(false);
    form.elements.low_price_confirm.checked = true;
    await submit();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ price: '6', category: 'camera' }));
  });

  it('blocks invalid input before upload and keeps helper/error associations', async () => {
    const { form, create, uploadPhoto, setPrice, submit } = setup();
    setPrice('-230000');
    await submit();
    expect(create).not.toHaveBeenCalled();
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(form.elements.price.getAttribute('aria-describedby')).toContain('mktFormError');
    setPrice('230,000');
    expect(form.elements.price.getAttribute('aria-describedby')).toBe('mktPriceHint mktPricePreview');
    expect(form.elements.low_price_confirm.required).toBe(false);
    await submit();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ price: '230,000' }));
  });

  it('requires an explicit category instead of defaulting to film', async () => {
    const { form, defaultCategory, create, setPrice, submit } = setup();
    expect(defaultCategory).toBe('');
    // Exercise the submission guard even when native required validation is bypassed.
    form.elements.category.value = '';
    setPrice('230000');
    await submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps a seller-confirmed low amount unchanged when editing', async () => {
    const { window, form, updateMine, setPrice, submit } = setup();
    window.auditMarket.STATE.editId = 'listing';
    window.auditMarket.STATE.rows = [{ id: 'listing', storage_paths: ['seller/photo.jpg'] }];
    setPrice('23');
    form.elements.low_price_confirm.checked = true;
    await submit();
    expect(updateMine).toHaveBeenCalledWith('listing', expect.objectContaining({ price: '23' }));
  });
});
