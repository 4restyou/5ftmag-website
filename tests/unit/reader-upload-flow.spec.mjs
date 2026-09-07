import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

beforeEach(() => {
  vi.useFakeTimers();
  window.eval(readFileSync('js/reader-upload-flow.js', 'utf8'));
});
afterEach(() => {
  vi.useRealTimers();
  delete window.__readerUploadTotalTimeoutMs;
  delete window.__readerUploadTimeoutMs;
});

function setup(overrides = {}) {
  const flow = window.ReaderUploadFlow;
  const blob = new Blob(['photo'], { type: 'image/jpeg' });
  const submissions = {
    uploadPhoto: vi.fn().mockResolvedValue({ error: null }),
    uploadPhotoResumable: vi.fn().mockResolvedValue({ error: null }),
    photoExists: vi.fn().mockResolvedValue({ exists: false }),
    ...overrides,
  };
  const opts = {
    file: blob, db: { submissions }, fmtBytes: String,
    readLocalJwtUser: () => ({ id: 'owner' }), resizeToJpeg: vi.fn().mockResolvedValue({ blob }),
    uuid: () => 'photo-id', withNetworkTimeout: flow.withNetworkTimeout,
    setSubmitText: vi.fn(), uploadState: {}, uploadMeta: {},
  };
  return { opts, submissions, run: () => flow.uploadPhoto(opts) };
}

describe('reader upload recovery', () => {
  it('aborts the previous transfer before starting TUS', async () => {
    let signal;
    const { run, submissions } = setup({ uploadPhoto: vi.fn((_p, _b, opts) => {
      signal = opts.signal;
      return new Promise(() => {});
    }) });
    const result = run();
    await vi.advanceTimersByTimeAsync(45001);
    expect(signal.aborted).toBe(true);
    expect(submissions.uploadPhotoResumable).toHaveBeenCalledOnce();
    expect((await result).path).toContain('owner/');
  });
  it('recovers a successful storage write whose response was lost', async () => {
    const { run, submissions } = setup({
      uploadPhoto: vi.fn().mockResolvedValue({ error: { message: 'timeout' } }),
      photoExists: vi.fn().mockResolvedValue({ exists: true }),
    });
    await run();
    expect(submissions.uploadPhotoResumable).not.toHaveBeenCalled();
  });
  it.each([401, 403, 400])('does not re-encode or retry a terminal %s response', async status => {
    const { run, submissions, opts } = setup({ uploadPhoto: vi.fn().mockResolvedValue({ error: { status, message: 'denied' } }) });
    await expect(run()).rejects.toThrow('denied');
    expect(submissions.uploadPhotoResumable).not.toHaveBeenCalled();
    expect(opts.resizeToJpeg).toHaveBeenCalledOnce();
  });
  it('uses the same paths on a manual retry', async () => {
    const fail = { error: { message: 'network failed' } };
    const { run, submissions } = setup({ uploadPhoto: vi.fn().mockResolvedValue(fail), uploadPhotoResumable: vi.fn().mockResolvedValue(fail) });
    await expect(run()).rejects.toThrow();
    const firstPaths = submissions.uploadPhoto.mock.calls.map(c => c[0]);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(run()).rejects.toThrow();
    expect(submissions.uploadPhoto.mock.calls.slice(3).map(c => c[0])).toEqual(firstPaths);
  });
  it('bounds the entire operation and ignores late TUS progress', async () => {
    window.__readerUploadTotalTimeoutMs = 100;
    let tusOptions;
    const { run, opts } = setup({
      uploadPhoto: vi.fn().mockResolvedValue({ error: { message: 'network failed' } }),
      uploadPhotoResumable: vi.fn((_p, _b, options) => { tusOptions = options; return new Promise(() => {}); }),
    });
    const outcome = run().catch(error => error);
    await vi.advanceTimersByTimeAsync(101);
    expect((await outcome).message).toContain('시간 초과');
    expect(tusOptions.signal.aborted).toBe(true);
    const calls = opts.setSubmitText.mock.calls.length;
    tusOptions.onProgress(5, 5);
    expect(opts.setSubmitText).toHaveBeenCalledTimes(calls);
  });
  it('does not mistake an absent upload response for success', async () => {
    const { run, submissions } = setup({ uploadPhoto: vi.fn().mockResolvedValue(undefined) });
    await run();
    expect(submissions.uploadPhotoResumable).toHaveBeenCalledOnce();
  });
});
