const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parsePython, renderPreview } = require('../src/markdown.cjs');

test('only explicit blocks become Markdown, preserving source line numbers', async () => {
  const source = '# ordinary comment\r\n# [markdown]\r\n# # Experiment\r\n# **Bold** explanation\r\n# [/markdown]\r\nx = 1  # inline\r\n# ordinary again\r\n';
  const result = await parsePython(source);
  assert.equal(result.warning, null);
  assert.deepEqual(result.segments.map(s => [s.kind, s.startLine, s.endLine]), [['code', 1, 1], ['markdown', 2, 5], ['code', 6, 7]]);
  const preview = renderPreview(result);
  assert.match(preview.html, /<h1 id="experiment">Experiment<\/h1>/);
  assert.match(preview.html, /<strong>Bold<\/strong>/);
  assert.equal(result.segments[2].text, 'x = 1  # inline\n# ordinary again\n');
  assert.match(preview.html, /data-line="2"/);
  assert.match(preview.html, /syntax-comment/);
  assert.ok(!preview.html.includes('[markdown]'));
});

test('strings, regular comments and marker-looking inline comments stay code', async () => {
  const source = '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\ntext = """\n# [markdown]\n# not Markdown\n# [/markdown]\n"""\ntext2 = "# still a string"\nx = 1  # [markdown]\n# Real comment\n';
  const result = await parsePython(source);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].kind, 'code');
  assert.equal(result.segments[0].text, source);
});

test('Markdown indentation, fences, tables, blank paragraphs and Unicode are preserved', async () => {
  const source = '# [markdown]\n# # Résultats λ\n# - parent\n#   - nested\n\n# ```python\n# print(42)\n# ```\n#\n# | A | B |\n# | - | - |\n# | 1 | 2 |\n# [/markdown]\n';
  const result = await parsePython(source);
  assert.equal(result.segments.length, 1);
  const { html } = renderPreview(result);
  assert.match(html, /Résultats λ/);
  assert.match(html, /<table>/);
  assert.match(html, /class="language-python"/);
  assert.equal((html.match(/<ul>/g) || []).length, 2);
});

test('missing or malformed Markdown delimiters never swallow Python code', async () => {
  for (const source of [
    '# [markdown]\n# missing end\n',
    '# [markdown]\n# prose\nx = 42\n# [/markdown]\n',
    '# [/markdown]\nx = 42\n',
  ]) {
    const result = await parsePython(source);
    assert.match(result.warning, /Markdown/);
    assert.ok(result.segments.every(s => s.kind === 'code'));
    assert.equal(result.segments.map(s => s.text).join(''), source);
  }
});

test('syntax highlighting preserves exact Unicode source and Python token classes', async () => {
  const source = 'class Model:\n    def predict(self, x=2):\n        # ordinary comment\n        print("λ 😀", x + 1)\n        return """multi\nline"""\n';
  const result = await parsePython(source);
  const code = result.segments[0];
  assert.equal(code.runs.map(run => run.text).join(''), source);
  const styles = new Set(code.runs.map(run => run.style));
  for (const style of ['keyword', 'class', 'function', 'builtin', 'number', 'string', 'comment', 'operator']) assert.ok(styles.has(style), style);
  const { html } = renderPreview(result);
  assert.match(html, /class="syntax-keyword">class<\/span>/);
  assert.match(html, /class="syntax-function">predict<\/span>/);
  assert.equal((html.match(/class="code-line"/g) || []).length, 6);
  assert.match(html, /class="line-number" aria-hidden="true">6</);
});

test('preview parses incomplete code without evaluating any source', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-prose-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const marker = path.join(dir, 'must-not-exist');
  const result = await parsePython(`# [markdown]\n# # Intro\n# [/markdown]\nopen(${JSON.stringify(marker)}, 'w').write('executed')\ntext = """\n# unfinished string\n`);
  assert.match(result.warning, /Incomplete Python/);
  assert.equal(result.segments[0].kind, 'markdown');
  assert.match(result.segments.at(-1).text, /# unfinished string/);
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
});

test('raw HTML, malicious links, and code are escaped, with links routed through host', () => {
  const parsed = { segments: [
    { kind: 'markdown', startLine: 1, endLine: 5, text: '# Heading\n<script>alert(1)</script>\n[bad](javascript:alert(1))\n[web](https://example.com)\n[local](#heading)\n![plot](plot.png)' },
    { kind: 'code', startLine: 6, endLine: 6, text: 'x = "</code><script>boom</script>"' },
  ] };
  const { html, links } = renderPreview(parsed, { imageUri: src => `vscode-resource:/project/${src}` });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('href="https:'));
  assert.deepEqual(links, ['https://example.com', '#heading']);
  assert.match(html, /data-anchor="heading"/);
  assert.match(html, /src="vscode-resource:\/project\/plot.png"/);
});

test('empty files and parser cancellation are handled', async () => {
  assert.match(renderPreview(await parsePython('')).html, /file is empty/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(parsePython('# prose', { signal: controller.signal }), /cancelled/);
});

test('triple-quoted md blocks render without comment prefixes', async () => {
  const source = '# ordinary comment\n"""md\n# Experiment\n\nCompare **models**.\n"""\nx = 2\n';
  const result = await parsePython(source);
  assert.equal(result.warning, null);
  assert.deepEqual(result.segments.map(s => [s.kind, s.startLine, s.endLine]), [['code', 1, 1], ['markdown', 2, 6], ['code', 7, 7]]);
  assert.equal(result.segments[1].text, '# Experiment\n\nCompare **models**.\n');
  assert.match(renderPreview(result).html, /<strong>models<\/strong>/);
});

test('assigned strings and strings inside expressions never become Markdown', async () => {
  for (const source of [
    'text = """md\n# Not prose\n"""\n',
    'print(\n"""md\n# Not prose\n"""\n)\n',
    '(\n"""md\n# Not prose\n"""\n)\n',
    '"""md\n# Not prose\n""" + "suffix"\n',
    '"""normal docstring\n# Not prose\n"""\n',
  ]) {
    const result = await parsePython(source);
    assert.ok(result.segments.every(s => s.kind === 'code'), source);
    assert.equal(result.segments.map(s => s.text).join(''), source);
  }
});

test('indented and raw single-quote blocks preserve Markdown whitespace', async () => {
  const source = "def describe():\n    r'''md\n    # Model\n    - parent\n      - nested\n    \\alpha\n    '''\n    return 1\n";
  const result = await parsePython(source);
  assert.equal(result.segments[1].text, '# Model\n- parent\n  - nested\n\\alpha\n');
  assert.equal(result.segments[1].startLine, 2);
});

test('unfinished Markdown strings stay code until closed', async () => {
  const source = '"""md\n# Still typing\n';
  const result = await parsePython(source);
  assert.match(result.warning, /Incomplete Python/);
  assert.equal(result.segments[0].kind, 'code');
  assert.equal(result.segments[0].text, source);
});
