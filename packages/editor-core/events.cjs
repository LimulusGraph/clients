// SSE framing must tolerate arbitrary transport boundaries and CRLF.
async function readEvents(response, onEvent) {
  if (!response.ok) throw new Error(await response.text());
  if (!response.body) throw new Error('The backend returned no event stream.');
  let pending = '', completed = false;
  const decoder = new TextDecoder();
  for await (const bytes of response.body) {
    pending += decoder.decode(bytes, { stream: true });
    let match;
    while ((match = /\r?\n\r?\n/.exec(pending))) {
      const frame = pending.slice(0, match.index);
      pending = pending.slice(match.index + match[0].length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      const event = JSON.parse(data);
      if (event.kind === 'completed') completed = true;
      onEvent(event);
    }
  }
  if (!completed) throw new Error('Backend disconnected before execution completed.');
}

module.exports = { readEvents };
