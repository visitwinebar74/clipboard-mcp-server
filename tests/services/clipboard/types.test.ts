/**
 * @fileoverview Tests for shared domain utilities in types.ts — stripHtmlTags, buildInspectFormats.
 * @module tests/services/clipboard/types.test
 */

import { describe, expect, it } from 'vitest';
import { buildInspectFormats, stripHtmlTags } from '@/services/clipboard/types.js';

describe('stripHtmlTags', () => {
  describe('basic tag stripping', () => {
    it('removes simple tags', () => {
      expect(stripHtmlTags('<p>Hello</p>')).toBe('Hello');
    });

    it('decodes common HTML entities', () => {
      // &nbsp; becomes a space; trailing spaces are trimmed by the final .trim()
      expect(stripHtmlTags('&amp; &lt; &gt; &quot; &#39; &nbsp;')).toBe('& < > " \'');
    });

    it('collapses whitespace and trims', () => {
      expect(stripHtmlTags('  <p>  hello   world  </p>  ')).toBe('hello world');
    });
  });

  describe('script and style content removal (issue #3)', () => {
    it('removes script tag and its content', () => {
      const html = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
      const result = stripHtmlTags(html);
      expect(result).not.toContain('alert');
      expect(result).not.toContain('xss');
      expect(result).toContain('Hello');
      expect(result).toContain('World');
    });

    it('removes style tag and its content', () => {
      const html = '<style>body { color: red; }</style><p>Hello</p>';
      const result = stripHtmlTags(html);
      expect(result).not.toContain('color');
      expect(result).not.toContain('body');
      expect(result).toContain('Hello');
    });

    it('removes multi-line script content', () => {
      const html =
        '<p>Before</p><script type="text/javascript">\n  var x = 1;\n  console.log(x);\n</script><p>After</p>';
      const result = stripHtmlTags(html);
      expect(result).not.toContain('console');
      expect(result).not.toContain('var x');
      expect(result).toBe('Before After');
    });

    it('handles script tag with attributes', () => {
      const html = '<script src="evil.js" async></script><p>Content</p>';
      const result = stripHtmlTags(html);
      expect(result).not.toContain('evil');
      expect(result).toBe('Content');
    });
  });

  describe('block-element word boundary insertion (issue #3)', () => {
    it('inserts space between adjacent block elements — h1 + p', () => {
      const html = '<h1>Title</h1><p>Body text</p>';
      const result = stripHtmlTags(html);
      expect(result).toBe('Title Body text');
    });

    it('inserts space at div boundaries', () => {
      expect(stripHtmlTags('<div>First</div><div>Second</div>')).toBe('First Second');
    });

    it('inserts space at li boundaries', () => {
      expect(stripHtmlTags('<ul><li>Item 1</li><li>Item 2</li></ul>')).toBe('Item 1 Item 2');
    });

    it('handles br tags as word separators', () => {
      expect(stripHtmlTags('Line 1<br>Line 2')).toBe('Line 1 Line 2');
      expect(stripHtmlTags('Line 1<br/>Line 2')).toBe('Line 1 Line 2');
    });

    it('no double spacing when block element has trailing whitespace', () => {
      const html = '<p>Hello </p><p>World</p>';
      const result = stripHtmlTags(html);
      // Should collapse to single spaces
      expect(result).toBe('Hello World');
    });

    it('all h1–h6 headings insert word breaks', () => {
      for (let i = 1; i <= 6; i++) {
        const html = `<h${i}>Heading</h${i}><p>Content</p>`;
        const result = stripHtmlTags(html);
        expect(result).toBe('Heading Content');
      }
    });
  });

  describe('combined scenarios', () => {
    it('handles complex document with scripts, styles, and block elements', () => {
      const html = `
        <html>
          <head>
            <style>.foo { color: red; }</style>
            <title>Page</title>
          </head>
          <body>
            <h1>Title</h1>
            <p>First paragraph</p>
            <script>var analytics = {};</script>
            <p>Second paragraph</p>
          </body>
        </html>
      `;
      const result = stripHtmlTags(html);
      expect(result).toContain('Title');
      expect(result).toContain('First paragraph');
      expect(result).toContain('Second paragraph');
      expect(result).not.toContain('analytics');
      expect(result).not.toContain('color: red');
      // Block elements should produce spaces
      expect(result).toMatch(/Title\s+First paragraph/);
    });

    it('preserves inline content without extra spaces', () => {
      expect(stripHtmlTags('<b>bold</b> and <i>italic</i>')).toBe('bold and italic');
    });
  });
});

describe('buildInspectFormats', () => {
  it('returns empty primary format when no formats present', () => {
    const result = buildInspectFormats(new Set());
    expect(result.primaryFormat).toBe('empty');
    expect(result.availableFormats).toEqual([]);
  });

  it('returns text as primary when only text is present', () => {
    const result = buildInspectFormats(new Set(['text' as const]));
    expect(result.primaryFormat).toBe('text');
    expect(result.availableFormats).toEqual(['text']);
  });

  it('returns image as primary when image and text are present', () => {
    const result = buildInspectFormats(new Set(['text' as const, 'image' as const]));
    expect(result.primaryFormat).toBe('image');
  });

  it('returns html as primary over rtf and text', () => {
    const result = buildInspectFormats(new Set(['text' as const, 'rtf' as const, 'html' as const]));
    expect(result.primaryFormat).toBe('html');
  });
});
