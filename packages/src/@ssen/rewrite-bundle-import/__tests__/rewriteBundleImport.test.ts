import { rewriteBundleImport } from '@ssen/rewrite-bundle-import';
import { describe, test, expect } from 'vitest';

describe('rewriteBundleImport()', () => {
  test('should rewrite import paths', () => {
    expect(rewriteBundleImport({ importPath: './a.png' })).toBe('./a.png.js');
    expect(rewriteBundleImport({ importPath: './a' })).toBe('./a');
    expect(rewriteBundleImport({ importPath: './a.js' })).toBe('./a.js');
  });
});
