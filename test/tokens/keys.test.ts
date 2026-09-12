import { describe, expect, it } from 'vitest';

import {
  MAX_TOKEN_KEY_LENGTH,
  delimitersFor,
  instanceIdOf,
  isTokenTag,
  isValidTokenKey,
  markerTextOf,
  parseMarkers,
  parseTokenTag,
  syntaxOf,
  tokenTagOf,
  unescapeMarkers,
} from '../../src/tokens/keys.js';

describe('token tags', () => {
  it('writes a tagged content control code for a typed token', () => {
    expect(tokenTagOf('field', 'employee.surname')).toBe('docier:field:employee.surname');
    expect(tokenTagOf('image', 'employee.photo')).toBe('docier:image:employee.photo');
    expect(tokenTagOf('loop', 'rows.benefits')).toBe('docier:loop:rows.benefits');
  });

  it('reads a bare key back as a field token', () => {
    expect(parseTokenTag('docier:employee.surname')).toEqual({
      kind: 'field',
      key: 'employee.surname',
    });
  });

  it('reads a typed code back', () => {
    expect(parseTokenTag('docier:image:employee.photo')).toEqual({
      kind: 'image',
      key: 'employee.photo',
    });
    expect(parseTokenTag('docier:if:contract.remote')).toEqual({
      kind: 'if',
      key: 'contract.remote',
    });
  });

  it('refuses a tag that is not a token and a code with an unknown kind', () => {
    expect(parseTokenTag('plain-tag')).toBeUndefined();
    expect(parseTokenTag(undefined)).toBeUndefined();
    expect(parseTokenTag('docier:unknownkind:key')).toBeUndefined();
    expect(parseTokenTag('docier:field:')).toBeUndefined();
    expect(parseTokenTag('docier:field:has space')).toBeUndefined();
    expect(isTokenTag('docier:field:key')).toBe(true);
    expect(isTokenTag('docier:unknownkind:key')).toBe(false);
  });

  it('enforces the key shape and length', () => {
    expect(isValidTokenKey('employee.surname')).toBe(true);
    expect(isValidTokenKey('rows[0].amount')).toBe(true);
    expect(isValidTokenKey('')).toBe(false);
    expect(isValidTokenKey('a b')).toBe(false);
    expect(isValidTokenKey('a'.repeat(MAX_TOKEN_KEY_LENGTH))).toBe(true);
    expect(isValidTokenKey('a'.repeat(MAX_TOKEN_KEY_LENGTH + 1))).toBe(false);
  });

  it('builds a stable instance id from the tag, paragraph and control id', () => {
    expect(instanceIdOf('docier:field:surname', 2, 7)).toBe('docier:field:surname#2#7');
    expect(instanceIdOf('docier:field:surname', 2, undefined)).toBe('docier:field:surname#2#x');
  });
});

describe('marker syntax', () => {
  it('maps a trigger to its delimiters and syntax name', () => {
    expect(delimitersFor('{{')).toEqual({ open: '{{', close: '' });
    expect(delimitersFor('«')).toEqual({ open: '«', close: '»' });
    expect(delimitersFor('[')).toEqual({ open: '[', close: ']' });
    expect(syntaxOf('{{')).toBe('braces');
    expect(syntaxOf('«')).toBe('guillemets');
    expect(syntaxOf('[')).toBe('brackets');
  });

  it('renders a visible marker for a key and a typed token', () => {
    expect(markerTextOf('field', 'surname', '{{')).toBe('{{surname}}');
    expect(markerTextOf('field', 'surname', '«')).toBe('«surname»');
    expect(markerTextOf('image', 'photo', '{{')).toBe('{{image:photo}}');
  });

  it('finds markers in running text and honours the escape', () => {
    const found = parseMarkers('Dear {{employee.surname}}, welcome.', { trigger: '{{' });
    expect(found.map((marker) => marker.key)).toEqual(['employee.surname']);
    expect(found[0]?.start).toBe(5);
    expect(found[0]?.end).toBe(25);
    expect(parseMarkers('literal \\{{not.a.token}}', { trigger: '{{' })).toHaveLength(0);
    expect(unescapeMarkers('literal \\{{x}}', '{{')).toBe('literal {{x}}');
  });

  it('reads a typed marker body', () => {
    const found = parseMarkers('{{image:employee.photo}}', { trigger: '{{' });
    expect(found[0]?.kind).toBe('image');
    expect(found[0]?.key).toBe('employee.photo');
  });
});
