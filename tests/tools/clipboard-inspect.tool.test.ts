/**
 * @fileoverview Tests for clipboard_inspect tool.
 * @module tests/tools/clipboard-inspect.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clipboardInspect } from '@/mcp-server/tools/definitions/clipboard-inspect.tool.js';

// Mock the clipboard service module
vi.mock('@/services/clipboard/clipboard-service.js', () => ({
  getClipboardService: vi.fn(),
  initClipboardService: vi.fn(),
}));

import { getClipboardService } from '@/services/clipboard/clipboard-service.js';

const mockGetService = vi.mocked(getClipboardService);

describe('clipboardInspect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns inspect result with primaryFormat and availableFormats', async () => {
    const mockInspect = vi.fn().mockResolvedValueOnce({
      primaryFormat: 'text' as const,
      availableFormats: ['text' as const],
      rawTypes: [{ type: 'public.utf8-plain-text', bytes: 12 }],
    });
    mockGetService.mockReturnValueOnce({ inspect: mockInspect } as ReturnType<
      typeof getClipboardService
    >);

    const ctx = createMockContext({ errors: clipboardInspect.errors });
    const input = clipboardInspect.input.parse({});
    const result = await clipboardInspect.handler(input, ctx);
    expect(result.primaryFormat).toBe('text');
    expect(result.availableFormats).toEqual(['text']);
    expect(result.rawTypes).toHaveLength(1);
  });

  it('returns empty state when clipboard is empty', async () => {
    const mockInspect = vi.fn().mockResolvedValueOnce({
      primaryFormat: 'empty' as const,
      availableFormats: [],
      rawTypes: [],
    });
    mockGetService.mockReturnValueOnce({ inspect: mockInspect } as ReturnType<
      typeof getClipboardService
    >);

    const ctx = createMockContext({ errors: clipboardInspect.errors });
    const input = clipboardInspect.input.parse({});
    const result = await clipboardInspect.handler(input, ctx);
    expect(result.primaryFormat).toBe('empty');
    expect(result.availableFormats).toEqual([]);
  });

  it('returns multiple formats when html + text + image are all present', async () => {
    const mockInspect = vi.fn().mockResolvedValueOnce({
      primaryFormat: 'image' as const,
      availableFormats: ['text' as const, 'html' as const, 'image' as const],
      rawTypes: [
        { type: 'public.utf8-plain-text', bytes: 10 },
        { type: 'public.html', bytes: 200 },
        { type: 'public.png', bytes: 51200 },
      ],
    });
    mockGetService.mockReturnValueOnce({ inspect: mockInspect } as ReturnType<
      typeof getClipboardService
    >);

    const ctx = createMockContext({ errors: clipboardInspect.errors });
    const input = clipboardInspect.input.parse({});
    const result = await clipboardInspect.handler(input, ctx);
    expect(result.primaryFormat).toBe('image');
    expect(result.availableFormats).toContain('html');
    expect(result.rawTypes).toHaveLength(3);
  });

  it('formats output with primaryFormat, availableFormats, and rawTypes table', () => {
    const output = {
      primaryFormat: 'html' as const,
      availableFormats: ['text' as const, 'html' as const],
      rawTypes: [
        { type: 'public.utf8-plain-text', bytes: 15 },
        { type: 'public.html', bytes: 350 },
      ],
    };
    const blocks = clipboardInspect.format!(output);
    const text = blocks.find((b) => b.type === 'text')?.text ?? '';
    expect(text).toContain('html');
    expect(text).toContain('public.utf8-plain-text');
    expect(text).toContain('350');
  });

  it('formats empty clipboard result', () => {
    const output = { primaryFormat: 'empty' as const, availableFormats: [], rawTypes: [] };
    const blocks = clipboardInspect.format!(output);
    const text = blocks.find((b) => b.type === 'text')?.text ?? '';
    expect(text).toContain('empty');
  });
});
