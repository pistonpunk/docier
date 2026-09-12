import { describe, expect, it } from 'vitest';
import type { LayoutResult, StoryLayout } from '../../src/layout/index.js';
import { bodyOf, layoutOf, paragraphText } from './support.js';

const resultOf = (): Promise<LayoutResult> => layoutOf(bodyOf(paragraphText('aaaa bbbb')));

describe('the layout result hands out no mutable story map', () => {
  it('refuses a write to the story map', async () => {
    const result = await resultOf();
    const stories = result.stories as Map<string, StoryLayout>;
    const injected: StoryLayout = { id: 'injected', kind: 'body', laidOut: true, blockCount: 0 };
    expect(() => {
      stories.set('injected', injected);
    }).toThrow(TypeError);
    expect(result.stories.size).toBe(1);
    expect(result.stories.has('injected')).toBe(false);
  });

  it('refuses a delete and a clear', async () => {
    const result = await resultOf();
    const stories = result.stories as Map<string, StoryLayout>;
    expect(() => {
      stories.delete('body');
    }).toThrow(TypeError);
    expect(() => {
      stories.clear();
    }).toThrow(TypeError);
    expect(result.stories.size).toBe(1);
  });

  it('keeps the map readable as an entries map', async () => {
    const result = await resultOf();
    const entries = [...result.stories.entries()];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.[1]?.laidOut).toBe(true);
    expect([...result.stories.keys()]).toEqual(['body']);
    expect(result.stories.get('body')?.id).toBe('body');
  });
});
