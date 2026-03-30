import { describe, it, expect } from 'vitest';
import {
  GAME_TYPE_LABEL_MAP,
  buildTagSuggestions,
  matchesTags,
  filterSuggestions,
  getGameTags,
  parseTagsFromUrl,
  tagsToUrlParam,
} from './tag-utils';
import type { TagSuggestion, SelectedTag } from './tag-utils';
import type { GameSummary } from '@/types/game';

function makeGame(overrides: Partial<GameSummary> = {}): GameSummary {
  return {
    gameId: 'game-1',
    gameType: 'OTHELLO',
    status: 'ACTIVE',
    aiSide: 'BLACK',
    currentTurn: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    tags: [],
    ...overrides,
  };
}

describe('GAME_TYPE_LABEL_MAP', () => {
  it('should map all known gameType values to Japanese labels', () => {
    expect(GAME_TYPE_LABEL_MAP['OTHELLO']).toBe('オセロ');
    expect(GAME_TYPE_LABEL_MAP['CHESS']).toBe('チェス');
    expect(GAME_TYPE_LABEL_MAP['GO']).toBe('囲碁');
    expect(GAME_TYPE_LABEL_MAP['SHOGI']).toBe('将棋');
  });
  it('should have exactly 4 entries', () => {
    expect(Object.keys(GAME_TYPE_LABEL_MAP)).toHaveLength(4);
  });
});

describe('buildTagSuggestions', () => {
  it('should generate gameType virtual tags', () => {
    const result = buildTagSuggestions([makeGame({ gameType: 'OTHELLO' })]);
    expect(result).toContainEqual({ label: 'オセロ', value: 'OTHELLO', type: 'gameType' });
  });
  it('should generate custom tags', () => {
    const result = buildTagSuggestions([makeGame({ tags: ['初心者向け'] })]);
    expect(result).toContainEqual({ label: '初心者向け', value: '初心者向け', type: 'custom' });
  });
  it('should exclude E2E tags (case-insensitive)', () => {
    const result = buildTagSuggestions([makeGame({ tags: ['E2E', 'e2e', 'valid-tag'] })]);
    const values = result.map((s) => s.value);
    expect(values).not.toContain('E2E');
    expect(values).not.toContain('e2e');
    expect(values).toContain('valid-tag');
  });
  it('should deduplicate tags across multiple games', () => {
    const result = buildTagSuggestions([
      makeGame({ gameId: 'g1', gameType: 'OTHELLO', tags: ['tag-a'] }),
      makeGame({ gameId: 'g2', gameType: 'OTHELLO', tags: ['tag-a'] }),
    ]);
    expect(result.filter((s) => s.value === 'OTHELLO')).toHaveLength(1);
    expect(result.filter((s) => s.value === 'tag-a')).toHaveLength(1);
  });
  it('should return empty array for empty input', () => {
    expect(buildTagSuggestions([])).toEqual([]);
  });
  it('should return only gameType tag when no custom tags', () => {
    const result = buildTagSuggestions([makeGame({ tags: [] })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('gameType');
  });
  it('should return only gameType when all tags are E2E', () => {
    const result = buildTagSuggestions([makeGame({ tags: ['E2E', 'e2e'] })]);
    expect(result.every((s) => s.type === 'gameType')).toBe(true);
  });
});

describe('matchesTags', () => {
  it('should return true when selectedTags is empty', () => {
    expect(matchesTags(makeGame(), [])).toBe(true);
  });
  it('should match gameType tag', () => {
    const tags: SelectedTag[] = [{ label: 'オセロ', value: 'OTHELLO', type: 'gameType' }];
    expect(matchesTags(makeGame({ gameType: 'OTHELLO' }), tags)).toBe(true);
  });
  it('should not match wrong gameType tag', () => {
    const tags: SelectedTag[] = [{ label: 'チェス', value: 'CHESS', type: 'gameType' }];
    expect(matchesTags(makeGame({ gameType: 'OTHELLO' }), tags)).toBe(false);
  });
  it('should match custom tag', () => {
    const tags: SelectedTag[] = [{ label: '初心者向け', value: '初心者向け', type: 'custom' }];
    expect(matchesTags(makeGame({ tags: ['初心者向け'] }), tags)).toBe(true);
  });
  it('should apply AND condition for multiple tags', () => {
    const tags: SelectedTag[] = [
      { label: 'オセロ', value: 'OTHELLO', type: 'gameType' },
      { label: '初心者向け', value: '初心者向け', type: 'custom' },
    ];
    expect(matchesTags(makeGame({ gameType: 'OTHELLO', tags: ['初心者向け'] }), tags)).toBe(true);
  });
  it('should fail AND condition when one tag does not match', () => {
    const tags: SelectedTag[] = [
      { label: 'オセロ', value: 'OTHELLO', type: 'gameType' },
      { label: '初心者向け', value: '初心者向け', type: 'custom' },
    ];
    expect(matchesTags(makeGame({ gameType: 'OTHELLO', tags: [] }), tags)).toBe(false);
  });
});

describe('filterSuggestions', () => {
  const suggestions: TagSuggestion[] = [
    { label: 'オセロ', value: 'OTHELLO', type: 'gameType' },
    { label: 'チェス', value: 'CHESS', type: 'gameType' },
    { label: '初心者向け', value: '初心者向け', type: 'custom' },
  ];
  it('should return all when query is empty', () => {
    expect(filterSuggestions(suggestions, '')).toEqual(suggestions);
  });
  it('should filter by partial match on label', () => {
    const result = filterSuggestions(suggestions, 'オセ');
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('OTHELLO');
  });
  it('should be case-insensitive', () => {
    const items: TagSuggestion[] = [{ label: 'TestTag', value: 'TestTag', type: 'custom' }];
    expect(filterSuggestions(items, 'testtag')).toHaveLength(1);
  });
  it('should return empty when no match', () => {
    expect(filterSuggestions(suggestions, '存在しない')).toEqual([]);
  });
  it('should return empty when suggestions is empty', () => {
    expect(filterSuggestions([], 'オセロ')).toEqual([]);
  });
  it('should match substring in the middle', () => {
    const result = filterSuggestions(suggestions, '心者');
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('初心者向け');
  });
});

describe('getGameTags', () => {
  it('should include gameType virtual tag as first element', () => {
    const result = getGameTags(makeGame({ gameType: 'OTHELLO', tags: ['tag-a'] }));
    expect(result[0]).toEqual({ label: 'オセロ', value: 'OTHELLO', type: 'gameType' });
  });
  it('should include custom tags after gameType tag', () => {
    const result = getGameTags(makeGame({ tags: ['tag-a', 'tag-b'] }));
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[1]).toEqual({ label: 'tag-a', value: 'tag-a', type: 'custom' });
  });
  it('should exclude E2E tags', () => {
    const values = getGameTags(makeGame({ tags: ['E2E', 'valid'] })).map((t) => t.value);
    expect(values).not.toContain('E2E');
    expect(values).toContain('valid');
  });
  it('should truncate to maximum 3 tags', () => {
    expect(getGameTags(makeGame({ tags: ['a', 'b', 'c', 'd'] }))).toHaveLength(3);
  });
  it('should return only gameType tag when no custom tags', () => {
    const result = getGameTags(makeGame({ tags: [] }));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('gameType');
  });
  it('should handle game with only E2E tags', () => {
    const result = getGameTags(makeGame({ tags: ['E2E'] }));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('gameType');
  });
});

describe('parseTagsFromUrl', () => {
  it('should parse comma-separated tags', () => {
    expect(parseTagsFromUrl(new URLSearchParams('tags=オセロ,初心者向け'))).toEqual([
      'オセロ',
      '初心者向け',
    ]);
  });
  it('should return empty array when tags param is missing', () => {
    expect(parseTagsFromUrl(new URLSearchParams(''))).toEqual([]);
  });
  it('should return empty array when tags param is empty', () => {
    expect(parseTagsFromUrl(new URLSearchParams('tags='))).toEqual([]);
  });
  it('should filter out empty segments', () => {
    expect(parseTagsFromUrl(new URLSearchParams('tags=オセロ,,'))).toEqual(['オセロ']);
  });
  it('should handle encoded URL values', () => {
    expect(parseTagsFromUrl(new URLSearchParams(`tags=${encodeURIComponent('オセロ')}`))).toEqual([
      'オセロ',
    ]);
  });
  it('should trim whitespace', () => {
    expect(parseTagsFromUrl(new URLSearchParams('tags= オセロ , チェス '))).toEqual([
      'オセロ',
      'チェス',
    ]);
  });
  it('should handle single tag', () => {
    expect(parseTagsFromUrl(new URLSearchParams('tags=オセロ'))).toEqual(['オセロ']);
  });
});

describe('tagsToUrlParam', () => {
  it('should convert tags to comma-separated encoded string', () => {
    const result = tagsToUrlParam(['オセロ', '初心者向け']);
    expect(result).toContain(encodeURIComponent('オセロ'));
    expect(result).toContain(',');
  });
  it('should return empty string for empty array', () => {
    expect(tagsToUrlParam([])).toBe('');
  });
  it('should handle single tag', () => {
    expect(tagsToUrlParam(['オセロ'])).toBe(encodeURIComponent('オセロ'));
  });
});

describe('URL round-trip', () => {
  it('should preserve tags through encode/decode cycle', () => {
    const original = ['オセロ', '初心者向け', 'tag-with-dash'];
    const decoded = parseTagsFromUrl(new URLSearchParams(`tags=${tagsToUrlParam(original)}`));
    expect(decoded).toEqual(original);
  });
  it('should preserve single tag', () => {
    const decoded = parseTagsFromUrl(new URLSearchParams(`tags=${tagsToUrlParam(['チェス'])}`));
    expect(decoded).toEqual(['チェス']);
  });
  it('should handle empty array', () => {
    expect(tagsToUrlParam([])).toBe('');
  });
});
