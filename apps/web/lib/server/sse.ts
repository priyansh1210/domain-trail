// Server-sent events over the POST response (spec 001 tech §1, spec 009 tech §4.1).
const encoder = new TextEncoder();

export interface EventSink {
  send(event: string, data: unknown): void;
  close(): void;
}

export function eventStream(
  run: (sink: EventSink) => Promise<void>,
  opts: { heartbeatMs?: number } = {},
): Response {
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const sink: EventSink = {
        send(event, data) {
          if (!closed)
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        },
        close() {
          if (closed) return;
          closed = true;
          clearInterval(timer);
          controller.close();
        },
      };
      // Keeps proxies from closing a quiet stream.
      timer = setInterval(
        () => !closed && controller.enqueue(encoder.encode(': ping\n\n')),
        opts.heartbeatMs ?? 10_000,
      );
      try {
        await run(sink);
      } finally {
        sink.close();
      }
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

/** Reads a request body as text, refusing anything over `maxBytes` without buffering it all (FR-ABU-009). */
export async function readLimited(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
