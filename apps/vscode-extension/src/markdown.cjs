const { defaultPython } = require('@limulus/node-host/platform');
const MarkdownIt = require('../vendor/markdown-it.cjs');
const { spawn } = require('node:child_process');
const path = require('node:path');

function parsePython(source, { python = defaultPython(), signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Preview cancelled.')); return; }
    // Isolated Python ignores workspace imports, PYTHONPATH, and user site startup code.
    const child = spawn(python, ['-I', '-X', 'utf8', path.join(__dirname, 'preview_parser.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errorText = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) { child.kill(); reject(error); } else resolve(value);
    };
    const abort = () => finish(new Error('Preview cancelled.'));
    const timer = setTimeout(() => finish(new Error('Python preview parsing timed out.')), 10000);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', error => finish(new Error(`Cannot start Python for preview: ${error.message}. Check limulus.pythonPath.`)));
    child.stdin.on('error', error => finish(error));
    child.stdout.on('data', bytes => {
      output += bytes.toString();
      if (output.length > 16 * 1024 * 1024) finish(new Error('This Python file is too large to preview.'));
    });
    child.stderr.on('data', bytes => { errorText = (errorText + bytes.toString()).slice(-4000); });
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) { finish(new Error(errorText || `Python parser exited with code ${code}.`)); return; }
      try { finish(null, JSON.parse(output)); } catch (error) { finish(error); }
    });
    child.stdin.end(JSON.stringify({ source }));
  });
}

function renderPreview(parsed, { imageUri = () => null } = {}) {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  const escape = md.utils.escapeHtml;
  const links = [];
  md.renderer.rules.link_open = (tokens, idx) => {
    const href = tokens[idx].attrGet('href') || '';
    // All navigation passes through the host's URI validation, never command: links.
    const index = links.push(href) - 1;
    let anchor = '';
    if (href.startsWith('#')) { try { anchor = decodeURIComponent(href.slice(1)); } catch {} }
    return `<a href="#" data-link="${index}"${anchor ? ` data-anchor="${escape(anchor)}"` : ''}>`;
  };
  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx];
    const src = imageUri(token.attrGet('src') || '');
    const alt = md.renderer.renderInlineAsText(token.children || [], md.options, {});
    return src ? `<img src="${escape(src)}" alt="${escape(alt)}">` : `<span class="image-placeholder">${escape(alt || 'Image not available')}</span>`;
  };
  // Unique heading anchors allow ordinary Markdown [links](#heading).
  const slugs = new Map();
  md.renderer.rules.heading_open = (tokens, idx) => {
    const title = tokens[idx + 1]?.content || '';
    const base = title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'heading';
    const count = slugs.get(base) || 0; slugs.set(base, count + 1);
    const id = count ? `${base}-${count}` : base;
    return `<${tokens[idx].tag} id="${escape(id)}">`;
  };
  const styles = new Set(['comment', 'string', 'number', 'keyword', 'class', 'function', 'builtin', 'operator']);
  const codePreview = segment => {
    const lines = [''];
    for (const run of segment.runs || [{ text: segment.text }]) {
      const parts = run.text.split('\n');
      parts.forEach((text, index) => {
        if (index) lines.push('');
        const escaped = escape(text);
        lines[lines.length - 1] += styles.has(run.style) ? `<span class="syntax-${run.style}">${escaped}</span>` : escaped;
      });
    }
    if (segment.text.endsWith('\n')) lines.pop();
    return `<pre class="python-code" tabindex="0"><code>${lines.map((line, i) => `<span class="code-line"><span class="line-number" aria-hidden="true">${segment.startLine + i}</span><span class="line-content">${line || '\u200b'}</span></span>`).join('')}</code></pre>`;
  };
  const html = parsed.segments.map(segment => {
    if (segment.kind === 'markdown') {
      return `<section class="source-section markdown"><button class="source-link" data-line="${segment.startLine}" title="Reveal Markdown block in source">Lines ${segment.startLine}–${segment.endLine}</button>${md.render(segment.text)}</section>`;
    }
    return `<section class="source-section code"><div class="code-heading"><span class="language-label">Python</span><button class="source-link" data-line="${segment.startLine}" title="Reveal in Python source">Lines ${segment.startLine}–${segment.endLine}</button></div>${codePreview(segment)}</section>`;
  }).join('\n');
  return { html: html || '<p class="empty">This Python file is empty. Write Python normally. For Markdown, use a standalone <code>&quot;&quot;&quot;md</code> block ending with <code>&quot;&quot;&quot;</code>.</p>', links };
}
module.exports = { parsePython, renderPreview };
