import { describe, expect, it, vi } from 'vitest';
import { clearCleanupBlock } from '../../../src/adapters/browser/download-lifecycle';
import { requestBrowserDownload } from '../../../src/adapters/browser/download';

function environment(options: {
  revokeThrows?: boolean;
  urlCreateThrows?: boolean;
  urlCreateEmpty?: boolean;
  anchorCreateThrows?: boolean;
  clickThrows?: boolean;
  removeThrows?: boolean;
  addListenerThrows?: boolean;
  removeListenerThrows?: boolean;
  timerThrows?: boolean;
  timers?: Array<() => void>;
} = {}) {
  const anchor = {
    href: '',
    download: '',
    rel: '',
    click: vi.fn(() => {
      if (options.clickThrows) throw new Error('synthetic click failure');
    }),
    remove: vi.fn(() => {
      if (options.removeThrows) throw new Error('synthetic remove failure');
    }),
  } as unknown as HTMLAnchorElement;
  const listeners = new Map<string, EventListener>();
  const document = {
    createElement: vi.fn(() => {
      if (options.anchorCreateThrows) throw new Error('synthetic anchor failure');
      return anchor;
    }),
  } as unknown as Document;
  const window = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (options.addListenerThrows) throw new Error('synthetic listener failure');
      listeners.set(type, listener);
    }),
    removeEventListener: vi.fn((type: string) => {
      if (options.removeListenerThrows) throw new Error('synthetic listener cleanup failure');
      listeners.delete(type);
    }),
  } as unknown as Window;
  const URLApi = {
    createObjectURL: vi.fn(() => {
      if (options.urlCreateThrows) throw new Error('synthetic URL failure');
      if (options.urlCreateEmpty) return '';
      return 'blob:synthetic';
    }),
    revokeObjectURL: vi.fn(() => {
      if (options.revokeThrows) throw new Error('synthetic cleanup failure');
    }),
  };
  const timers = options.timers ?? [];
  const timer = options.timerThrows
    ? ((() => { throw new Error('synthetic timer failure'); }) as unknown as typeof setTimeout)
    : ((callback: () => void) => { timers.push(callback); return 1; }) as unknown as typeof setTimeout;
  return {
    anchor,
    listeners,
    URLApi,
    environment: { document, window, URL: URLApi, Blob, setTimeout: timer },
    timers,
  };
}

describe('DOM download adapter', () => {
  it('clicks synchronously and only reports download-requested', () => {
    const env = environment();
    const result = requestBrowserDownload({
      format: 'json',
      text: '{"synthetic":true}\n',
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: env.environment,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe('download-requested');
    expect((env.anchor.click as ReturnType<typeof vi.fn>).mock.invocationCallOrder.length).toBe(1);
    expect(env.anchor.remove).toHaveBeenCalledTimes(1);
    expect(env.URLApi.createObjectURL).toHaveBeenCalledTimes(1);
    expect(env.timers).toHaveLength(1);
    env.timers[0]();
    expect(result.value.cleanup_result?.ok).toBe(true);
    expect(result.value.blob).toBeNull();
    expect(result.value.object_url).toBeNull();
    expect(env.URLApi.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
  });

  it('binds a native window timer when no timer override is supplied', () => {
    const env = environment();
    const scheduled: Array<() => void> = [];
    const nativeWindow = {
      addEventListener: (env.environment.window as Window).addEventListener,
      removeEventListener: (env.environment.window as Window).removeEventListener,
      setTimeout(this: unknown, callback: () => void) {
        if (this !== nativeWindow) throw new TypeError('Illegal invocation');
        scheduled.push(callback);
        return 1;
      },
    } as unknown as Window;
    const result = requestBrowserDownload({
      format: 'json',
      text: '{"synthetic":true}\n',
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: { ...env.environment, window: nativeWindow, setTimeout: undefined },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(scheduled).toHaveLength(1);
    scheduled[0]();
    expect(result.value.cleanup_result?.ok).toBe(true);
    expect(result.value.state).toBe('download-requested');
  });

  it('requires explicit user action and does not create browser resources', () => {
    const env = environment();
    const result = requestBrowserDownload({
      format: 'markdown',
      text: '# synthetic\n',
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.md',
      mime: 'text/markdown;charset=UTF-8;variant=GFM',
      environment: env.environment,
    });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-download-request-failed' }) });
    expect(env.URLApi.createObjectURL).not.toHaveBeenCalled();
  });

  it('cleans immediately on pagehide and blocks after cleanup failure', () => {
    const env = environment({ revokeThrows: true });
    const result = requestBrowserDownload({
      format: 'json',
      text: '{"synthetic":true}\n',
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: env.environment,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    env.listeners.get('pagehide')?.(new Event('pagehide'));
    expect(result.value.cleanup_result).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-resource-cleanup-failed' }) });
    expect(result.value.state).toBe('failed');
    expect(env.listeners.has('pagehide')).toBe(false);
    const blocked = requestBrowserDownload({
      format: 'json',
      text: '{"synthetic":true}\n',
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: env.environment,
    });
    expect(blocked).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-resource-cleanup-failed' }) });
    clearCleanupBlock();
  });

  it('cleans the previous request before allowing a second explicit generation', () => {
    const env = environment();
    const first = requestBrowserDownload({
      format: 'json',
      text: '{"first":true}\n',
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: env.environment,
    });
    expect(first.ok).toBe(true);
    const second = requestBrowserDownload({
      format: 'json',
      text: '{"second":true}\n',
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: env.environment,
    });
    expect(second.ok).toBe(true);
    expect(env.URLApi.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
  });

  it('keeps timer scheduling failure separate from cleanup failure', () => {
    const env = environment({ timerThrows: true });
    const result = requestBrowserDownload({
      format: 'json',
      text: '{"synthetic":true}\n',
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: env.environment,
    });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-download-request-failed' }) });
    expect(env.URLApi.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
    const next = environment();
    expect(requestBrowserDownload({
      format: 'json',
      text: '{"synthetic":true}\n',
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: next.environment,
    }).ok).toBe(true);
  });

  it('returns stable request failures for DOM setup, listener, and click exceptions', () => {
    const cases = [
      { options: { urlCreateThrows: true }, code: 'export-blob-creation-failed', revoke: false },
      { options: { urlCreateEmpty: true }, code: 'export-blob-creation-failed', revoke: true, revokeValue: '' },
      { options: { anchorCreateThrows: true }, code: 'export-download-request-failed', revoke: true, revokeValue: 'blob:synthetic' },
      { options: { addListenerThrows: true }, code: 'export-download-request-failed', revoke: true, revokeValue: 'blob:synthetic' },
      { options: { clickThrows: true }, code: 'export-download-request-failed', revoke: true, revokeValue: 'blob:synthetic' },
    ] as const;
    for (const item of cases) {
      const env = environment(item.options);
      const result = requestBrowserDownload({
        format: 'json',
        text: '{"synthetic":true}\n',
        file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
        mime: 'application/json',
        explicit_user_action: true,
        environment: env.environment,
      });
      expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: item.code }) });
      if (item.revoke) expect(env.URLApi.revokeObjectURL).toHaveBeenCalledWith(item.revokeValue);
      else expect(env.URLApi.revokeObjectURL).not.toHaveBeenCalled();
      clearCleanupBlock();
    }
  });

  it('blocks after listener cleanup failure and reports the cleanup error', () => {
    const env = environment({ removeListenerThrows: true });
    const result = requestBrowserDownload({
      format: 'json',
      text: '{"synthetic":true}\n',
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: env.environment,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    env.timers[0]?.();
    expect(result.value.cleanup_result).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-resource-cleanup-failed' }) });
    expect(result.value.state).toBe('failed');
    const blocked = requestBrowserDownload({
      format: 'json',
      text: '{"synthetic":true}\n',
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: env.environment,
    });
    expect(blocked).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-resource-cleanup-failed' }) });
    clearCleanupBlock();
  });

  it('blocks after anchor cleanup failure without exposing DOM details', () => {
    const env = environment({ removeThrows: true });
    const result = requestBrowserDownload({
      format: 'json',
      text: '{"synthetic":true}\n',
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: env.environment,
    });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-resource-cleanup-failed' }) });
    expect(env.URLApi.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
    clearCleanupBlock();
  });

  it('enforces the exact 1 MiB UTF-8 format boundary before browser resources', () => {
    const atLimit = environment();
    const exact = requestBrowserDownload({
      format: 'json',
      text: 'x'.repeat(1024 * 1024),
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: atLimit.environment,
    });
    expect(exact.ok).toBe(true);
    const over = environment();
    const tooLarge = requestBrowserDownload({
      format: 'json',
      text: 'x'.repeat(1024 * 1024 + 1),
      file_name: 'zhiguan-purchase-decision-20260115T000000Z.json',
      mime: 'application/json',
      explicit_user_action: true,
      environment: over.environment,
    });
    expect(tooLarge).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-resource-limit-exceeded' }) });
    expect(over.URLApi.createObjectURL).not.toHaveBeenCalled();
  });
});
