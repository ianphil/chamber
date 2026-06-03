import { describe, expect, it, vi } from 'vitest';
import { registerChamberHandlers } from './registerHandlers';

describe('registerChamberHandlers', () => {
  it('registers the Chamber custom task handlers on the executor', () => {
    const executor = {
      register: vi.fn(),
    } as unknown as { register: (type: string, handler: unknown) => void };

    registerChamberHandlers(executor as never);

    expect(executor.register).toHaveBeenCalledTimes(4);
    expect(executor.register).toHaveBeenNthCalledWith(1, 'chamber:prompt', expect.any(Function));
    expect(executor.register).toHaveBeenNthCalledWith(2, 'chamber:notify', expect.any(Function));
    expect(executor.register).toHaveBeenNthCalledWith(3, 'chamber:a2a', expect.any(Function));
    expect(executor.register).toHaveBeenNthCalledWith(4, 'http', expect.any(Function));
  });
});
