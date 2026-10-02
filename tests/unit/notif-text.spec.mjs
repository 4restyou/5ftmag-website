import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

// 알림 문구 함수(site-common.js 의 window.MagNotifText)를 언어별로 확인한다.
const i18nSource = readFileSync('js/i18n.js', 'utf8');
const commonSource = readFileSync('js/site-common.js', 'utf8');
let dom;
afterEach(() => dom?.window.close());

function setup(lang) {
  dom = new JSDOM(`<!doctype html><html lang="${lang}"><body></body></html>`, {
    url: 'https://5ftmag.com/' + (lang === 'ko' ? '' : lang + '/') + 'me.html',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  if (lang !== 'ko') window.eval(i18nSource);
  window.eval(commonSource);
  return window.MagNotifText;
}

const approved = {
  type: 'submission_approved',
  title: '사진이 승인됐어요',
  body: 'Portra 400 사진이 라이브러리에 공개됐어요.',
  meta: { film: 'Portra 400' },
};

describe('MagNotifText', () => {
  it('ko: 저장된 문구를 그대로 쓴다', () => {
    const notifText = setup('ko');
    expect(notifText(approved)).toEqual({ title: approved.title, body: approved.body });
  });

  it('ko: 사유 없는 반려는 새 사유 없음 문구', () => {
    const notifText = setup('ko');
    const row = { type: 'submission_rejected', title: '사진이 반려됐어요', body: '편집부 사유를 /me.html 에서 확인하세요', meta: { film: null, reason: null } };
    expect(notifText(row).body).toBe('이번 사진은 싣지 않기로 했어요. 다른 컷으로 다시 응모해 주세요.');
  });

  it('en: submission_approved + meta.film 은 영문', () => {
    const notifText = setup('en');
    expect(notifText(approved)).toEqual({
      title: 'Your photo is live',
      body: 'Your Portra 400 photo is now in the library.',
    });
  });

  it('en: meta 없는 옛 행은 저장된 한국어 그대로', () => {
    const notifText = setup('en');
    const row = { ...approved, meta: null };
    expect(notifText(row)).toEqual({ title: approved.title, body: approved.body });
  });

  it('ja: submission_rejected + 사유 없음은 일본어 사유 없음 문구', () => {
    const notifText = setup('ja');
    const row = { type: 'submission_rejected', title: '사진이 반려됐어요', body: '이번 사진은 싣지 않기로 했어요. 다른 컷으로 다시 응모해 주세요.', meta: { film: 'Gold 200', reason: null } };
    expect(notifText(row)).toEqual({
      title: '写真は不採用になりました',
      body: '今回は掲載を見送りました。別の1コマでまたご応募ください。',
    });
  });

  it('en: 반려 사유가 있으면 사람이 쓴 사유 그대로', () => {
    const notifText = setup('en');
    const row = { type: 'submission_rejected', title: '사진이 반려됐어요', body: '초점이 맞지 않아요', meta: { reason: '초점이 맞지 않아요' } };
    expect(notifText(row).body).toBe('초점이 맞지 않아요');
  });

  it('en: 예약된 이주의 사진은 날짜를 영문으로', () => {
    const notifText = setup('en');
    const row = { type: 'submission_featured', title: '이주의 사진으로 뽑혔어요', body: '…', meta: { film: 'HP5', date: '2026-10-12', live: false } };
    expect(notifText(row)).toEqual({
      title: 'Your photo was picked as Photo of the Week',
      body: 'It goes up on October 12. (HP5)',
    });
  });

  it('en: 필름 제안 결과는 meta 의 brand·name·notes', () => {
    const notifText = setup('en');
    const row = { type: 'proposal_approved', title: '신청하신 필름이 등록됐어요', body: 'Kodak Gold 200', meta: { brand: 'Kodak', name: 'Gold 200', notes: 'thanks' } };
    expect(notifText(row)).toEqual({ title: 'Your film suggestion was added', body: 'Kodak Gold 200 · thanks' });
  });

  it('모르는 type 은 저장된 문구', () => {
    const notifText = setup('en');
    const row = { type: 'submission_pending_editor', title: '검토할 사진', body: '새 투고 1건', meta: { x: 1 } };
    expect(notifText(row)).toEqual({ title: '검토할 사진', body: '새 투고 1건' });
  });
});
