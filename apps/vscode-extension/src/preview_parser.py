"""Extract standalone md strings (and legacy comment blocks) without executing code."""
import builtins
import io
import json
import keyword
import sys
import tokenize

START = '[markdown]'
END = '[/markdown]'
BUILTINS = frozenset(dir(builtins))


def parse(source):
    lines = source.replace('\r\n', '\n').replace('\r', '\n').splitlines(keepends=True)
    normalized = ''.join(lines)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))

    def offset(position):
        row, column = position
        return offsets[min(row - 1, len(lines))] + column

    comments, highlights, warnings = {}, [], []
    string_blocks = {}
    statement = []

    def finish_statement():
        if len(statement) != 1 or statement[0].type != tokenize.STRING:
            return
        token = statement[0]
        value = token.string
        # A standalone literal, never an assignment, argument, f-string or expression.
        if value[:1] in ('r', 'R'):
            value = value[1:]
        quote = value[:3]
        if quote not in ('"' * 3, "'" * 3) or not value.startswith(quote + 'md\n'):
            return
        start, column = token.start
        end, end_column = token.end
        indent = lines[start - 1][:column]
        if indent.strip() or lines[end - 1][end_column:].strip():
            return
        if lines[end - 1][:end_column - 3].strip():
            return  # Closing delimiter must be on its own line.
        content = value[6:-3]  # triple quote + md + newline
        if indent and content.endswith(indent):
            content = content[:-len(indent)]
        text = ''.join(line[len(indent):] if indent and line.startswith(indent) else line
                       for line in content.splitlines(keepends=True))
        string_blocks[start] = (end, text)
    string_depth = 0
    definition = None
    previous = None
    try:
        for token in tokenize.generate_tokens(io.StringIO(normalized).readline):
            if token.type in (tokenize.NEWLINE, tokenize.ENDMARKER):
                finish_statement()
                statement.clear()
            elif token.type not in (tokenize.NL, tokenize.COMMENT, tokenize.INDENT, tokenize.DEDENT):
                statement.append(token)
            name = tokenize.tok_name.get(token.type, '')
            if name in ('FSTRING_START', 'TSTRING_START'):
                string_depth += 1
            in_string = string_depth > 0
            style = None
            if token.type == tokenize.COMMENT:
                style = 'comment'
            elif token.type == tokenize.STRING or name.startswith(('FSTRING_', 'TSTRING_')):
                style = 'string'
            elif token.type == tokenize.NUMBER:
                style = 'number'
            elif token.type == tokenize.NAME:
                if keyword.iskeyword(token.string):
                    style = 'keyword'
                    if token.string in ('def', 'class'):
                        definition = token.string
                elif definition:
                    style = 'class' if definition == 'class' else 'function'
                    definition = None
                elif token.string in BUILTINS and previous != '.':
                    style = 'builtin'
            elif token.type == tokenize.OP:
                style = 'operator'
            if style:
                highlights.append((offset(token.start), offset(token.end), style))
            if token.type not in (tokenize.INDENT, tokenize.DEDENT, tokenize.NL, tokenize.NEWLINE, tokenize.COMMENT):
                previous = token.string
            if not in_string and token.type == tokenize.COMMENT:
                row, column = token.start
                if not token.line[:column].strip():
                    text = token.string[1:]
                    comments[row] = text[1:] if text.startswith(' ') else text
            if name in ('FSTRING_END', 'TSTRING_END'):
                string_depth -= 1
    except (tokenize.TokenError, IndentationError, SyntaxError) as error:
        warnings.append('Incomplete Python syntax; remaining text stays code. ' + str(error))

    # Only complete blocks made entirely of comments/blank lines become Markdown.
    blocks = dict(string_blocks)
    row = 1
    while row <= len(lines):
        if comments.get(row, '').strip() != START:
            if comments.get(row, '').strip() == END:
                warnings.append(f'Line {row}: Markdown end marker has no matching start.')
            row += 1
            continue
        start = row
        cursor = row + 1
        content = []
        while cursor <= len(lines):
            text = comments.get(cursor)
            if text is not None and text.strip() == END:
                blocks[start] = (cursor, ''.join(content))
                row = cursor + 1
                break
            if text is not None and text.strip() != START:
                content.append(text + ('\n' if lines[cursor - 1].endswith('\n') else ''))
            elif not lines[cursor - 1].strip():
                content.append(lines[cursor - 1])
            else:
                warnings.append(f'Line {start}: Markdown block must contain only comments and end with # {END}; left as code.')
                row = cursor  # Do not hide code or a new, independently valid block.
                break
            cursor += 1
        else:
            warnings.append(f'Line {start}: Markdown block is missing # {END}; left as code.')
            row = cursor

    segments = []
    row = 1
    highlight_index = 0
    while row <= len(lines):
        start = row
        if row in blocks:
            end, text = blocks[row]
            segments.append(dict(kind='markdown', text=text, startLine=start, endLine=end))
            row = end + 1
            continue
        while row <= len(lines) and row not in blocks:
            row += 1
        text = ''.join(lines[start - 1:row - 1])
        if not text.strip():
            continue
        first, last = offsets[start - 1], offsets[row - 1]
        position = first
        runs = []
        while highlight_index < len(highlights) and highlights[highlight_index][1] <= first:
            highlight_index += 1
        index = highlight_index
        while index < len(highlights) and highlights[index][0] < last:
            left, right, style = highlights[index]
            left, right = max(first, left, position), min(last, right)
            if position < left:
                runs.append(dict(text=normalized[position:left]))
            if right > left:
                runs.append(dict(text=normalized[left:right], style=style))
                position = right
            index += 1
        if position < last:
            runs.append(dict(text=normalized[position:last]))
        segments.append(dict(kind='code', text=text, runs=runs, startLine=start, endLine=row - 1))
    return dict(segments=segments, warning='\n'.join(warnings) or None)


if __name__ == '__main__':
    request = json.load(sys.stdin)
    json.dump(parse(request['source']), sys.stdout, ensure_ascii=True)
