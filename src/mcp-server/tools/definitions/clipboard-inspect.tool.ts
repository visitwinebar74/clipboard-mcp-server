/**
 * @fileoverview clipboard_inspect tool — list clipboard types and sizes without reading content.
 * @module mcp-server/tools/definitions/clipboard-inspect.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getClipboardService } from '@/services/clipboard/clipboard-service.js';

export const clipboardInspect = tool('clipboard_inspect', {
  title: 'Inspect Clipboard',
  description:
    'List the formats and byte sizes of what is currently on the clipboard without reading the full content. ' +
    'Use this before calling clipboard_read to see what formats are available and how large they are. ' +
    'Returns primaryFormat (the richest format present, using priority image > html > rtf > text), ' +
    'the list of all available semantic formats, and a table of raw platform type identifiers with sizes.',
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: z.object({}),
  output: z.object({
    primaryFormat: z
      .enum(['text', 'html', 'rtf', 'image', 'empty'])
      .describe(
        'The richest format explicitly present on the clipboard (image > html > rtf > text). ' +
          '"empty" if the clipboard has no recognized content.',
      ),
    availableFormats: z
      .array(z.enum(['text', 'html', 'rtf', 'image']))
      .describe(
        'All semantic formats present. Use to decide which format to pass to clipboard_read.',
      ),
    rawTypes: z
      .array(
        z
          .object({
            type: z
              .string()
              .describe(
                'UTI or pasteboard type identifier (e.g., "public.utf8-plain-text", "public.html").',
              ),
            bytes: z
              .number()
              .int()
              .describe(
                'Size of this representation in bytes. ' +
                  'On Linux, sizes are measured by reading each format — may add latency for large items.',
              ),
          })
          .describe('A single pasteboard type entry with its identifier and byte size.'),
      )
      .describe(
        'All explicitly-set pasteboard types with byte sizes. Useful for debugging or understanding exactly what was copied.',
      ),
  }),
  errors: [
    {
      reason: 'clipboard_unavailable',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'Required clipboard tool not found on this platform.',
      recovery:
        'Install the platform clipboard tool: macOS (built-in), Linux X11 (apt install xclip), Linux Wayland (apt install wl-clipboard), Windows (PowerShell 5.1+).',
    },
  ],

  async handler(_input, ctx) {
    ctx.log.info('clipboard_inspect');
    const svc = getClipboardService();
    const result = await svc.inspect(ctx);
    return result;
  },

  format: (result) => {
    const lines: string[] = [];
    lines.push(`**Primary format:** ${result.primaryFormat}`);
    if (result.availableFormats.length > 0) {
      lines.push(`**Available formats:** ${result.availableFormats.join(', ')}`);
    } else {
      lines.push('**Available formats:** (none)');
    }
    if (result.rawTypes.length > 0) {
      lines.push('\n**Raw types:**');
      lines.push('| Type | Bytes |');
      lines.push('|:-----|------:|');
      for (const t of result.rawTypes) {
        lines.push(`| \`${t.type}\` | ${t.bytes.toLocaleString()} |`);
      }
    } else {
      lines.push('\n**Raw types:** (empty clipboard)');
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
