import { z } from 'zod';

/**
 * How one JSON message is delimited on a TCP stream.
 *
 * TCP is a byte stream with no message boundaries, so "send JSON over TCP"
 * is not a complete instruction — both ends must agree where one message
 * stops and the next begins. Qtech have not specified this yet, and there are
 * only a few plausible conventions, so all of them are implemented and the
 * choice is configuration rather than code. When they confirm, it is one
 * environment variable, not a rebuild.
 *
 *   newline  Send the JSON followed by \n; read until \n.
 *            The most common convention for line-oriented JSON over TCP.
 *
 *   length   A 4-byte big-endian unsigned length, then that many bytes of
 *            JSON. Common where messages may contain newlines.
 *
 *   raw      Send the JSON and nothing else; the peer closing the connection
 *            delimits the response. Only workable with one exchange per
 *            connection, which is how this bridge works by default.
 */
export const TcpFramingSchema = z.enum(['newline', 'length', 'raw']);
export type TcpFraming = z.infer<typeof TcpFramingSchema>;

const MAX_MESSAGE_BYTES = 1024 * 64;

/** Encode one message for the wire. */
export function encodeFrame(json: string, framing: TcpFraming): Buffer {
  const payload = Buffer.from(json, 'utf8');
  switch (framing) {
    case 'newline':
      return Buffer.concat([payload, Buffer.from('\n', 'utf8')]);
    case 'length': {
      const header = Buffer.alloc(4);
      header.writeUInt32BE(payload.length, 0);
      return Buffer.concat([header, payload]);
    }
    case 'raw':
      return payload;
  }
}

/**
 * Incremental reader. Fed bytes as they arrive, it returns a complete message
 * as soon as one is available, or null while still waiting.
 *
 * A stream reader has to be incremental: TCP will happily split one message
 * across two reads, or deliver two messages in one. Parsing whatever happens
 * to be in the buffer is the classic way to get an integration like this
 * working on a quiet desk and failing under load.
 */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly framing: TcpFraming) {}

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_MESSAGE_BYTES) {
      throw new Error(`frame exceeded ${MAX_MESSAGE_BYTES} bytes without completing`);
    }
  }

  /** A complete message, or null if more bytes are needed. */
  next(): string | null {
    switch (this.framing) {
      case 'newline': {
        const i = this.buffer.indexOf(0x0a);
        if (i === -1) return null;
        const line = this.buffer.subarray(0, i).toString('utf8');
        this.buffer = this.buffer.subarray(i + 1);
        return line.trim();
      }
      case 'length': {
        if (this.buffer.length < 4) return null;
        const len = this.buffer.readUInt32BE(0);
        if (len > MAX_MESSAGE_BYTES) {
          throw new Error(`declared frame length ${len} exceeds the maximum`);
        }
        if (this.buffer.length < 4 + len) return null;
        const body = this.buffer.subarray(4, 4 + len).toString('utf8');
        this.buffer = this.buffer.subarray(4 + len);
        return body;
      }
      case 'raw':
        // Delimited by the peer closing the connection — see flush().
        return null;
    }
  }

  /**
   * Whatever remains once the peer has closed. Only meaningful for `raw`,
   * where the close *is* the delimiter.
   */
  flush(): string | null {
    if (this.framing !== 'raw') return null;
    const text = this.buffer.toString('utf8').trim();
    this.buffer = Buffer.alloc(0);
    return text.length > 0 ? text : null;
  }

  get pendingBytes(): number {
    return this.buffer.length;
  }
}
