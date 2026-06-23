import { describe, it, expect } from 'vitest';
import { Mutex } from './mutex.js';

describe('Mutex', () => {
  it('serializes overlapping critical sections (no interleave)', async () => {
    const m = new Mutex();
    const log: string[] = [];
    const section = (id: string) =>
      m.run(async () => {
        log.push(`${id}:start`);
        await new Promise((r) => setTimeout(r, 5));
        log.push(`${id}:end`);
      });

    // Launch both before awaiting — they overlap in time, but the mutex must run them
    // start→end without interleaving.
    await Promise.all([section('A'), section('B')]);
    expect(log).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
  });

  it('a rejecting section does not deadlock the queue', async () => {
    const m = new Mutex();
    await expect(m.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(m.run(async () => 42)).resolves.toBe(42);
  });

  it('returns each callback’s resolved value', async () => {
    const m = new Mutex();
    expect(await m.run(async () => 'x')).toBe('x');
  });
});
