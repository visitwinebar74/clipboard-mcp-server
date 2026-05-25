/**
 * @fileoverview Linux X11 clipboard backend using xclip.
 * @module services/clipboard/linux-x11-backend
 */

import { spawn } from 'node:child_process';
import type {
  ClipboardBackend,
  ClipboardFormat,
  InspectResult,
  RawTypeEntry,
  ReadResult,
} from './types.js';
import { buildInspectFormats } from './types.js';

/** Map MIME type (or X TARGETS entry) → semantic format. */
function mimeToFormat(mime: string): ClipboardFormat | null {
  if (
    mime === 'UTF8_STRING' ||
    mime === 'TEXT' ||
    mime === 'STRING' ||
    mime === 'text/plain' ||
    mime === 'text/plain;charset=utf-8'
  )
    return 'text';
  if (mime === 'text/html') return 'html';
  if (mime === 'text/rtf' || mime === 'application/rtf') return 'rtf';
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/bmp') return 'image';
  return null;
}

/** Run xclip with the given args; optionally write stdin. Returns stdout as Buffer. */
function runXclip(args: string[], stdin?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('xclip', args, {
      shell: false,
      stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    if (stdin) child.stdin?.end(stdin);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`xclip exited ${code}: ${Buffer.concat(err).toString('utf8').trim()}`));
      } else {
        resolve(Buffer.concat(out));
      }
    });
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('xclip not found — install with: apt install xclip'));
      } else {
        reject(err);
      }
    });
  });
}

/** Linux X11 clipboard backend using xclip. */
export class LinuxX11Backend implements ClipboardBackend {
  async inspect(): Promise<InspectResult> {
    // xclip -o -selection clipboard -t TARGETS lists available MIME types
    const buf = await runXclip(['-o', '-selection', 'clipboard', '-t', 'TARGETS']);
    const targets = buf
      .toString('utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const rawTypes: RawTypeEntry[] = [];
    const semanticSet = new Set<ClipboardFormat>();

    for (const target of targets) {
      const fmt = mimeToFormat(target);
      if (fmt) semanticSet.add(fmt);
      // Measure size by reading the content for each known semantic type
      // We only read for recognized MIME types to limit latency
      if (
        target === 'text/plain' ||
        target === 'UTF8_STRING' ||
        target === 'text/html' ||
        target === 'text/rtf' ||
        target === 'application/rtf' ||
        target === 'image/png'
      ) {
        try {
          const data = await runXclip(['-o', '-selection', 'clipboard', '-t', target]);
          rawTypes.push({ type: target, bytes: data.byteLength });
        } catch {
          rawTypes.push({ type: target, bytes: 0 });
        }
      } else {
        rawTypes.push({ type: target, bytes: 0 });
      }
    }

    return { rawTypes, ...buildInspectFormats(semanticSet) };
  }

  async read(format: ClipboardFormat): Promise<ReadResult> {
    switch (format) {
      case 'text': {
        const buf = await runXclip(['-o', '-selection', 'clipboard', '-t', 'UTF8_STRING']);
        return { format: 'text', content: buf };
      }
      case 'html': {
        const buf = await runXclip(['-o', '-selection', 'clipboard', '-t', 'text/html']);
        if (buf.byteLength === 0) throw new Error('HTML format not found on clipboard');
        return { format: 'html', content: buf };
      }
      case 'rtf': {
        // Try text/rtf first, then application/rtf
        let buf: Buffer;
        try {
          buf = await runXclip(['-o', '-selection', 'clipboard', '-t', 'text/rtf']);
        } catch {
          buf = await runXclip(['-o', '-selection', 'clipboard', '-t', 'application/rtf']);
        }
        if (buf.byteLength === 0) throw new Error('RTF format not found on clipboard');
        return { format: 'rtf', content: buf };
      }
      case 'image': {
        const buf = await runXclip(['-o', '-selection', 'clipboard', '-t', 'image/png']);
        if (buf.byteLength === 0) throw new Error('Image format not found on clipboard');
        return { format: 'image', content: buf };
      }
    }
  }

  async write(
    content: string,
    format: 'text' | 'html',
  ): Promise<{ format: 'text' | 'html'; byteSize: number }> {
    const buf = Buffer.from(content, 'utf8');
    if (format === 'text') {
      await runXclip(['-i', '-selection', 'clipboard', '-t', 'UTF8_STRING'], buf);
      return { format: 'text', byteSize: buf.byteLength };
    }
    await runXclip(['-i', '-selection', 'clipboard', '-t', 'text/html'], buf);
    return { format: 'html', byteSize: buf.byteLength };
  }
}
