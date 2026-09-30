import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVaultActivity } from '../../src/hooks/useVaultActivity';

const { invokeVoidMock } = vi.hoisted(() => ({ invokeVoidMock: vi.fn() }));

vi.mock('../../src/api/tauri', () => ({
  tauriInvoke: vi.fn(),
  tauriInvokeVoid: invokeVoidMock,
  tauriListen: vi.fn().mockResolvedValue(() => {}),
  tauriConvertFileSrc: vi.fn().mockReturnValue('asset://localhost/test'),
}));

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
}

describe('useVaultActivity', () => {
  let now: number;

  beforeEach(() => {
    now = 0;
    invokeVoidMock.mockReset().mockResolvedValue(undefined);
    setVisibility('visible');
    vi.spyOn(window.performance, 'now').mockImplementation(() => now);
  });

  it('throttles high-frequency input and stops after unmount', () => {
    const hook = renderHook(() => useVaultActivity(true));
    expect(invokeVoidMock).toHaveBeenCalledTimes(1);
    expect(invokeVoidMock).toHaveBeenLastCalledWith('cmd_record_vault_activity');

    act(() => {
      window.dispatchEvent(new Event('pointermove'));
      window.dispatchEvent(new Event('pointermove'));
      window.dispatchEvent(new Event('keydown'));
    });
    expect(invokeVoidMock).toHaveBeenCalledTimes(1);

    now = 5_000;
    act(() => window.dispatchEvent(new Event('pointermove')));
    expect(invokeVoidMock).toHaveBeenCalledTimes(2);

    hook.unmount();
    now = 10_000;
    act(() => window.dispatchEvent(new Event('pointerdown')));
    expect(invokeVoidMock).toHaveBeenCalledTimes(2);
  });

  it('ignores hidden input and records a visible resume', () => {
    renderHook(() => useVaultActivity(true));
    expect(invokeVoidMock).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    now = 5_000;
    act(() => window.dispatchEvent(new Event('pointerdown')));
    expect(invokeVoidMock).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(invokeVoidMock).toHaveBeenCalledTimes(2);
    expect(invokeVoidMock).toHaveBeenLastCalledWith('cmd_record_vault_activity');
  });

  it('does not report activity while the vault is locked', () => {
    const hook = renderHook(({ enabled }) => useVaultActivity(enabled), {
      initialProps: { enabled: false },
    });
    act(() => window.dispatchEvent(new Event('pointerdown')));
    expect(invokeVoidMock).not.toHaveBeenCalled();

    hook.rerender({ enabled: true });
    expect(invokeVoidMock).toHaveBeenCalledTimes(1);
  });
});
