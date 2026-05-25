/**
 * @fileoverview Windows clipboard backend using PowerShell and .NET System.Windows.Forms.Clipboard.
 * @module services/clipboard/windows-backend
 */

import { spawn } from 'node:child_process';
import type {
  ClipboardBackend,
  ClipboardFormat,
  InspectResult,
  RawTypeEntry,
  ReadResult,
} from './types.js';
import { buildInspectFormats, stripHtmlTags } from './types.js';

/** Run a PowerShell script. Returns stdout as Buffer. Optionally pipes stdin. */
function runPowershell(script: string, stdin?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = ['-NoProfile', '-NonInteractive', '-Command', script];
    const child = spawn('powershell.exe', args, {
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
        reject(
          new Error(`powershell exited ${code}: ${Buffer.concat(err).toString('utf8').trim()}`),
        );
      } else {
        resolve(Buffer.concat(out));
      }
    });
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('powershell.exe not found — requires PowerShell 5.1+ on Windows 10+'));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Static PowerShell script for inspecting clipboard formats.
 * Returns JSON array of { type: string, bytes: number }.
 * Uses System.Windows.Forms.Clipboard.GetDataObject() to list explicit formats.
 */
const PS_INSPECT = `
Add-Type -AssemblyName System.Windows.Forms
$data = [System.Windows.Forms.Clipboard]::GetDataObject()
$result = @()
if ($data) {
  foreach ($fmt in $data.GetFormats($false)) {
    $bytes = 0
    try {
      $obj = $data.GetData($fmt)
      if ($obj -is [string]) { $bytes = [System.Text.Encoding]::UTF8.GetByteCount($obj) }
      elseif ($obj -is [byte[]]) { $bytes = $obj.Length }
      elseif ($obj -is [System.IO.MemoryStream]) { $bytes = $obj.Length }
    } catch {}
    $result += [PSCustomObject]@{ type = $fmt; bytes = $bytes }
  }
}
$result | ConvertTo-Json -Compress
`;

/** Static PowerShell script to read plain text. */
const PS_READ_TEXT = `
Add-Type -AssemblyName System.Windows.Forms
$text = [System.Windows.Forms.Clipboard]::GetText()
if ([string]::IsNullOrEmpty($text)) { 'null' } else { $text }
`;

/** Static PowerShell script to read HTML from clipboard. */
const PS_READ_HTML = `
Add-Type -AssemblyName System.Windows.Forms
$data = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($data -and $data.GetDataPresent('HTML Format')) {
  $html = $data.GetData('HTML Format')
  if ($html -is [string]) {
    # Windows HTML clipboard format includes headers — extract just the HTML body
    $startIdx = $html.IndexOf('<html')
    if ($startIdx -eq -1) { $startIdx = $html.IndexOf('<HTML') }
    if ($startIdx -ge 0) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $html.Substring($startIdx) }
    else { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $html }
  } else { 'null' }
} else { 'null' }
`;

/** Static PowerShell script to read RTF from clipboard. */
const PS_READ_RTF = `
Add-Type -AssemblyName System.Windows.Forms
$data = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($data -and $data.GetDataPresent([System.Windows.Forms.DataFormats]::Rtf)) {
  $rtf = $data.GetData([System.Windows.Forms.DataFormats]::Rtf)
  if ($rtf -is [string]) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $rtf }
  else { 'null' }
} else { 'null' }
`;

/** Static PowerShell script to read image from clipboard as base64-encoded PNG. */
const PS_READ_IMAGE = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
  $ms = New-Object System.IO.MemoryStream
  $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $ms.Dispose()
  $img.Dispose()
  $b64 = [Convert]::ToBase64String($bytes)
  $w = $img.Width
  $h = $img.Height
  ConvertTo-Json @{ base64 = $b64; width = $w; height = $h } -Compress
} else { 'null' }
`;

/**
 * Build a PowerShell script that writes text to the clipboard.
 * Content is passed via base64 to avoid any shell interpretation.
 */
function buildPsWriteText(contentBase64: string): string {
  return `
Add-Type -AssemblyName System.Windows.Forms
$b64 = ${JSON.stringify(contentBase64)}
$bytes = [Convert]::FromBase64String($b64)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
[System.Windows.Forms.Clipboard]::SetText($text)
`;
}

/**
 * Build a PowerShell script that writes HTML + plain-text to the clipboard.
 * Content is passed via base64 to avoid any shell interpretation.
 */
function buildPsWriteHtml(htmlBase64: string, plaintextBase64: string): string {
  return `
Add-Type -AssemblyName System.Windows.Forms
$hb64 = ${JSON.stringify(htmlBase64)}
$pb64 = ${JSON.stringify(plaintextBase64)}
$htmlBytes = [Convert]::FromBase64String($hb64)
$html = [System.Text.Encoding]::UTF8.GetString($htmlBytes)
$ptBytes = [Convert]::FromBase64String($pb64)
$pt = [System.Text.Encoding]::UTF8.GetString($ptBytes)
$data = New-Object System.Windows.Forms.DataObject
$data.SetData([System.Windows.Forms.DataFormats]::Html, $html)
$data.SetData([System.Windows.Forms.DataFormats]::Text, $pt)
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
`;
}

/** Map Windows DataFormats string → semantic format. */
function winFormatToSemantic(fmt: string): ClipboardFormat | null {
  const lower = fmt.toLowerCase();
  if (lower === 'text' || lower === 'unicodetext' || lower === 'oemtext') return 'text';
  if (lower === 'html format') return 'html';
  if (lower === 'rich text format' || lower === 'rtf') return 'rtf';
  if (lower === 'bitmap' || lower === 'png' || lower === 'dib' || lower === 'dibv5') return 'image';
  return null;
}

/** Windows clipboard backend using PowerShell. */
export class WindowsBackend implements ClipboardBackend {
  async inspect(): Promise<InspectResult> {
    const buf = await runPowershell(PS_INSPECT);
    const raw = buf.toString('utf8').trim();

    let entries: Array<{ type: string; bytes: number }> = [];
    if (raw && raw !== 'null' && raw !== '') {
      try {
        const parsed = JSON.parse(raw);
        entries = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        entries = [];
      }
    }

    const rawTypes: RawTypeEntry[] = entries.map((e) => ({ type: e.type, bytes: e.bytes }));
    const semanticSet = new Set<ClipboardFormat>();
    for (const e of entries) {
      const fmt = winFormatToSemantic(e.type);
      if (fmt) semanticSet.add(fmt);
    }

    return { rawTypes, ...buildInspectFormats(semanticSet) };
  }

  async read(format: ClipboardFormat): Promise<ReadResult> {
    switch (format) {
      case 'text': {
        const buf = await runPowershell(PS_READ_TEXT);
        const text = buf.toString('utf8').trim();
        if (text === 'null') throw new Error('Text format not found on clipboard');
        return { format: 'text', content: Buffer.from(text, 'utf8') };
      }
      case 'html': {
        const buf = await runPowershell(PS_READ_HTML);
        const text = buf.toString('utf8').trim();
        if (text === 'null' || text === '') throw new Error('HTML format not found on clipboard');
        return { format: 'html', content: Buffer.from(text, 'utf8') };
      }
      case 'rtf': {
        const buf = await runPowershell(PS_READ_RTF);
        const text = buf.toString('utf8').trim();
        if (text === 'null' || text === '') throw new Error('RTF format not found on clipboard');
        return { format: 'rtf', content: Buffer.from(text, 'utf8') };
      }
      case 'image': {
        const buf = await runPowershell(PS_READ_IMAGE);
        const text = buf.toString('utf8').trim();
        if (text === 'null' || text === '') throw new Error('Image format not found on clipboard');
        const parsed = JSON.parse(text) as { base64: string; width: number; height: number };
        const content = Buffer.from(parsed.base64, 'base64');
        return { format: 'image', content, width: parsed.width, height: parsed.height };
      }
    }
  }

  async write(
    content: string,
    format: 'text' | 'html',
  ): Promise<{ format: 'text' | 'html'; byteSize: number }> {
    const buf = Buffer.from(content, 'utf8');
    if (format === 'text') {
      const b64 = buf.toString('base64');
      await runPowershell(buildPsWriteText(b64));
      return { format: 'text', byteSize: buf.byteLength };
    }
    const plaintext = stripHtmlTags(content);
    const htmlB64 = buf.toString('base64');
    const ptB64 = Buffer.from(plaintext, 'utf8').toString('base64');
    await runPowershell(buildPsWriteHtml(htmlB64, ptB64));
    return { format: 'html', byteSize: buf.byteLength };
  }
}
