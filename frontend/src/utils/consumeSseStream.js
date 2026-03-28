/**
 * Consume Server-Sent Events con fetch (streaming real).
 * EventSource + proxy de Vite a veces no entrega chunks hasta el final o dispara onerror en streams largos.
 *
 * @param {string|URL} url
 * @param {{ signal?: AbortSignal, onMessage: (obj: object) => void }} options
 * @returns {Promise<void>}
 */
export async function consumeSseStream(url, { signal, onMessage, headers = {} }) {
  const res = await fetch(typeof url === 'string' ? url : url.toString(), {
    method: 'GET',
    signal,
    headers: { Accept: 'text/event-stream', ...headers },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(text?.slice(0, 500) || `Error HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('El navegador no permitió leer el cuerpo del stream');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');

    let sep;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      const lines = block.split('\n');
      let dataPayload = '';
      for (const line of lines) {
        if (line.startsWith('data:')) {
          dataPayload += line.slice(5).trimStart();
        }
      }
      if (!dataPayload) continue;
      try {
        const obj = JSON.parse(dataPayload);
        onMessage(obj);
      } catch {
        /* línea no JSON */
      }
    }
  }
}
