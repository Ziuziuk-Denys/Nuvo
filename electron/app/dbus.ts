/** A small D-Bus client over the session bus socket: enough to own a name, serve one object and emit signals. No library. */
import { default as net } from "node:net";

export type Variant = [signature: string, value: unknown];

export const MESSAGE = { call: 1, reply: 2, error: 3, signal: 4 } as const;
export const NO_REPLY_EXPECTED = 0x1;
const MAX_MESSAGE = 1 << 20;

const ALIGN: Record<string, number> = { y: 1, n: 2, q: 2, b: 4, i: 4, u: 4, h: 4, s: 4, o: 4, a: 4, g: 1, v: 1, x: 8, t: 8, d: 8, "(": 8, "{": 8 };

function typeEnd(signature: string, start: number): number {
  const code = signature[start];
  if (code === "a") return typeEnd(signature, start + 1);
  if (code === "(" || code === "{") {
    const close = code === "(" ? ")" : "}";
    let at = start + 1;
    while (signature[at] !== close) {
      if (at >= signature.length) throw new Error(`unclosed D-Bus type in ${signature}`);
      at = typeEnd(signature, at);
    }
    return at + 1;
  }
  if (!code || !(code in ALIGN)) throw new Error(`unsupported D-Bus type in ${signature}`);
  return start + 1;
}

/** Splits a signature into its complete types: "sa{sv}as" gives ["s", "a{sv}", "as"]. */
export function splitSignature(signature: string): string[] {
  const types: string[] = [];
  for (let at = 0; at < signature.length;) {
    const end = typeEnd(signature, at);
    types.push(signature.slice(at, end));
    at = end;
  }
  return types;
}

/** Little-endian writer; the message start is offset 0, so alignment is relative to it. */
class Writer {
  private buffer = Buffer.alloc(256);
  length = 0;

  private ensure(bytes: number): void {
    if (this.length + bytes <= this.buffer.length) return;
    const grown = Buffer.alloc(Math.max(this.buffer.length * 2, this.length + bytes));
    this.buffer.copy(grown, 0, 0, this.length);
    this.buffer = grown;
  }

  align(to: number): void {
    const pad = (to - (this.length % to)) % to;
    this.ensure(pad);
    this.buffer.fill(0, this.length, this.length + pad);
    this.length += pad;
  }

  private bytes(data: Buffer): void {
    this.ensure(data.length);
    data.copy(this.buffer, this.length);
    this.length += data.length;
  }

  private fixed(size: number, put: (buffer: Buffer, at: number) => void): void {
    this.align(size);
    this.ensure(size);
    put(this.buffer, this.length);
    this.length += size;
  }

  write(type: string, value: unknown): void {
    switch (type[0]) {
      case "y":
        return this.fixed(1, (b, at) => b.writeUInt8(Number(value), at));
      case "n":
        return this.fixed(2, (b, at) => b.writeInt16LE(Number(value), at));
      case "q":
        return this.fixed(2, (b, at) => b.writeUInt16LE(Number(value), at));
      case "b":
        return this.fixed(4, (b, at) => b.writeUInt32LE(value ? 1 : 0, at));
      case "i":
        return this.fixed(4, (b, at) => b.writeInt32LE(Number(value), at));
      case "u":
      case "h":
        return this.fixed(4, (b, at) => b.writeUInt32LE(Number(value), at));
      case "x":
        return this.fixed(8, (b, at) => b.writeBigInt64LE(BigInt(value as number), at));
      case "t":
        return this.fixed(8, (b, at) => b.writeBigUInt64LE(BigInt(value as number), at));
      case "d":
        return this.fixed(8, (b, at) => b.writeDoubleLE(Number(value), at));
      case "s":
      case "o": {
        const text = Buffer.from(String(value), "utf8");
        this.write("u", text.length);
        this.bytes(Buffer.concat([text, Buffer.alloc(1)]));
        return;
      }
      case "g": {
        const text = Buffer.from(String(value), "ascii");
        this.write("y", text.length);
        this.bytes(Buffer.concat([text, Buffer.alloc(1)]));
        return;
      }
      case "v": {
        const [signature, inner] = value as Variant;
        this.write("g", signature);
        this.write(signature, inner);
        return;
      }
      case "a": {
        const element = type.slice(1);
        this.align(4);
        const lengthAt = this.length;
        this.write("u", 0);
        this.align(ALIGN[element[0]]);
        const start = this.length;
        const items = element[0] === "{" && !Array.isArray(value) ? Object.entries(value as object) : (value as unknown[]);
        for (const item of items) this.write(element, item);
        this.buffer.writeUInt32LE(this.length - start, lengthAt);
        return;
      }
      case "(":
      case "{": {
        this.align(8);
        const fields = value as unknown[];
        splitSignature(type.slice(1, -1)).forEach((field, index) => this.write(field, fields[index]));
        return;
      }
      default:
        throw new Error(`unsupported D-Bus type ${type}`);
    }
  }

  result(): Buffer {
    return this.buffer.subarray(0, this.length);
  }
}

/** Reads either byte order; dictionaries come back as [key, value] pairs. */
class Reader {
  constructor(
    private readonly buffer: Buffer,
    public at: number,
    private readonly little: boolean,
  ) {}

  private align(to: number): void {
    this.at += (to - (this.at % to)) % to;
  }

  private fixed<T>(size: number, little: (at: number) => T, big: (at: number) => T): T {
    this.align(size);
    if (this.at + size > this.buffer.length) throw new Error("D-Bus message truncated");
    const value = this.little ? little(this.at) : big(this.at);
    this.at += size;
    return value;
  }

  read(type: string): unknown {
    const b = this.buffer;
    switch (type[0]) {
      case "y":
        return this.fixed(
          1,
          (at) => b.readUInt8(at),
          (at) => b.readUInt8(at),
        );
      case "n":
        return this.fixed(
          2,
          (at) => b.readInt16LE(at),
          (at) => b.readInt16BE(at),
        );
      case "q":
        return this.fixed(
          2,
          (at) => b.readUInt16LE(at),
          (at) => b.readUInt16BE(at),
        );
      case "b":
        return (
          this.fixed(
            4,
            (at) => b.readUInt32LE(at),
            (at) => b.readUInt32BE(at),
          ) !== 0
        );
      case "i":
        return this.fixed(
          4,
          (at) => b.readInt32LE(at),
          (at) => b.readInt32BE(at),
        );
      case "u":
      case "h":
        return this.fixed(
          4,
          (at) => b.readUInt32LE(at),
          (at) => b.readUInt32BE(at),
        );
      case "x":
        return Number(
          this.fixed(
            8,
            (at) => b.readBigInt64LE(at),
            (at) => b.readBigInt64BE(at),
          ),
        );
      case "t":
        return Number(
          this.fixed(
            8,
            (at) => b.readBigUInt64LE(at),
            (at) => b.readBigUInt64BE(at),
          ),
        );
      case "d":
        return this.fixed(
          8,
          (at) => b.readDoubleLE(at),
          (at) => b.readDoubleBE(at),
        );
      case "s":
      case "o": {
        const length = this.read("u") as number;
        return this.text(length);
      }
      case "g": {
        const length = this.read("y") as number;
        return this.text(length);
      }
      case "v": {
        const signature = this.read("g") as string;
        return [signature, this.read(signature)] as Variant;
      }
      case "a": {
        const element = type.slice(1);
        const length = this.read("u") as number;
        this.align(ALIGN[element[0]]);
        const end = this.at + length;
        if (end > this.buffer.length) throw new Error("D-Bus array truncated");
        const items: unknown[] = [];
        while (this.at < end) items.push(this.read(element));
        return items;
      }
      case "(":
      case "{":
        this.align(8);
        return splitSignature(type.slice(1, -1)).map((field) => this.read(field));
      default:
        throw new Error(`unsupported D-Bus type ${type}`);
    }
  }

  private text(length: number): string {
    if (this.at + length + 1 > this.buffer.length) throw new Error("D-Bus string truncated");
    const value = this.buffer.toString("utf8", this.at, this.at + length);
    this.at += length + 1;
    return value;
  }
}

export interface Message {
  type: number;
  flags?: number;
  serial?: number;
  path?: string;
  interface?: string;
  member?: string;
  errorName?: string;
  replySerial?: number;
  destination?: string;
  sender?: string;
  signature?: string;
  body?: unknown[];
}

const FIELDS: Array<[code: number, key: keyof Message, type: string]> = [
  [1, "path", "o"],
  [2, "interface", "s"],
  [3, "member", "s"],
  [4, "errorName", "s"],
  [5, "replySerial", "u"],
  [6, "destination", "s"],
  [7, "sender", "s"],
  [8, "signature", "g"],
];

export function encodeMessage(message: Message, serial: number): Buffer {
  const signature = message.signature ?? "";
  const body = new Writer();
  splitSignature(signature).forEach((type, index) => body.write(type, message.body?.[index]));
  const fields: Array<[number, Variant]> = [];
  for (const [code, key, type] of FIELDS) {
    const value = key === "signature" ? signature || undefined : message[key];
    if (value !== undefined) fields.push([code, [type, value]]);
  }
  const head = new Writer();
  head.write("y", "l".charCodeAt(0));
  head.write("y", message.type);
  head.write("y", message.flags ?? 0);
  head.write("y", 1);
  head.write("u", body.length);
  head.write("u", serial);
  head.write("a(yv)", fields);
  head.align(8);
  return Buffer.concat([head.result(), body.result()]);
}

/** Total byte length of the message at the start of `buffer`, or null until its fixed header is in. */
export function messageLength(buffer: Buffer): number | null {
  if (buffer.length < 16) return null;
  const little = buffer[0] === "l".charCodeAt(0);
  if (!little && buffer[0] !== "B".charCodeAt(0)) throw new Error("bad D-Bus byte order");
  const bodyLength = little ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
  const fieldsLength = little ? buffer.readUInt32LE(12) : buffer.readUInt32BE(12);
  const headLength = 16 + fieldsLength + ((8 - ((16 + fieldsLength) % 8)) % 8);
  const total = headLength + bodyLength;
  if (total > MAX_MESSAGE) throw new Error("D-Bus message too large");
  return total;
}

export function decodeMessage(buffer: Buffer): Message {
  const little = buffer[0] === "l".charCodeAt(0);
  const reader = new Reader(buffer, 1, little);
  const type = reader.read("y") as number;
  const flags = reader.read("y") as number;
  reader.read("y");
  const bodyLength = reader.read("u") as number;
  const serial = reader.read("u") as number;
  const message: Message = { type, flags, serial };
  for (const [code, [, value]] of reader.read("a(yv)") as Array<[number, Variant]>) {
    const field = FIELDS.find(([known]) => known === code);
    if (field) (message as unknown as Record<string, unknown>)[field[1]] = value;
  }
  // the body starts 8-aligned; a fresh reader keeps alignment relative to the message start
  const bodyStart = buffer.length - bodyLength;
  const body = new Reader(buffer, bodyStart, little);
  message.body = splitSignature(message.signature ?? "").map((t) => body.read(t));
  return message;
}

/** The unix socket in a bus address such as "unix:path=/run/user/1000/bus"; abstract sockets get a leading NUL. */
export function socketPathOf(address: string | undefined): string | null {
  for (const entry of (address ?? "").split(";")) {
    const colon = entry.indexOf(":");
    if (entry.slice(0, colon) !== "unix") continue;
    const params = new Map<string, string>();
    for (const pair of entry.slice(colon + 1).split(",")) {
      const equals = pair.indexOf("=");
      try {
        params.set(pair.slice(0, equals), decodeURIComponent(pair.slice(equals + 1)));
      } catch {
        // a malformed escape: skip this pair
      }
    }
    const path = params.get("path");
    if (path) return path;
    const abstract = params.get("abstract");
    if (abstract) return `\0${abstract}`;
  }
  return null;
}

export class DBusError extends Error {
  constructor(
    readonly name: string,
    text: string,
  ) {
    super(text);
  }
}

/** One connection to a bus. `onCall` receives method calls addressed to this connection. */
export class BusConnection {
  onCall: (call: Message) => void = () => undefined;
  onClose: () => void = () => undefined;
  private serial = 0;
  private pending = new Map<number, { resolve: (body: unknown[]) => void; reject: (error: Error) => void }>();
  private input = Buffer.alloc(0);

  private constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => this.receive(chunk));
    socket.on("close", () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error("D-Bus connection closed"));
      this.pending.clear();
      this.onClose();
    });
    socket.on("error", () => socket.destroy());
  }

  /** Connects, authenticates as this user (EXTERNAL) and says Hello. */
  static async open(socketPath: string, uid: number, timeoutMs = 3000): Promise<BusConnection> {
    const socket = net.createConnection(socketPath);
    socket.setNoDelay(true);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("D-Bus auth timed out"));
      }, timeoutMs);
      let text = "";
      const fail = (error: Error) => {
        clearTimeout(timer);
        socket.removeListener("data", onData);
        reject(error);
      };
      const onData = (chunk: Buffer) => {
        text += chunk.toString("latin1");
        if (!text.includes("\r\n")) return;
        clearTimeout(timer);
        socket.removeListener("data", onData);
        socket.removeListener("error", fail);
        if (!text.startsWith("OK ")) {
          socket.destroy();
          reject(new Error(`D-Bus auth refused: ${text.trim()}`));
          return;
        }
        socket.write("BEGIN\r\n");
        resolve();
      };
      socket.once("error", fail);
      socket.on("data", onData);
      socket.write(`\0AUTH EXTERNAL ${Buffer.from(String(uid), "ascii").toString("hex")}\r\n`);
    });
    const bus = new BusConnection(socket);
    await bus.call({ destination: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus", member: "Hello" });
    return bus;
  }

  private send(message: Message): number {
    const serial = ++this.serial;
    this.socket.write(encodeMessage(message, serial));
    return serial;
  }

  call(message: Omit<Message, "type">): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      const serial = this.send({ ...message, type: MESSAGE.call });
      this.pending.set(serial, { resolve, reject });
    });
  }

  reply(call: Message, signature = "", body: unknown[] = []): void {
    if ((call.flags ?? 0) & NO_REPLY_EXPECTED) return;
    this.send({ type: MESSAGE.reply, destination: call.sender, replySerial: call.serial, signature, body });
  }

  error(call: Message, name: string, text: string): void {
    if ((call.flags ?? 0) & NO_REPLY_EXPECTED) return;
    this.send({ type: MESSAGE.error, destination: call.sender, replySerial: call.serial, errorName: name, signature: "s", body: [text] });
  }

  signal(message: Omit<Message, "type">): void {
    this.send({ ...message, type: MESSAGE.signal });
  }

  close(): void {
    this.socket.end();
    this.socket.destroy();
  }

  private receive(chunk: Buffer): void {
    this.input = Buffer.concat([this.input, chunk]);
    try {
      for (let length = messageLength(this.input); length !== null && this.input.length >= length; length = messageLength(this.input)) {
        const message = decodeMessage(this.input.subarray(0, length));
        this.input = this.input.subarray(length);
        this.dispatch(message);
      }
    } catch (error) {
      console.warn("[dbus] dropping the connection:", error);
      this.socket.destroy();
    }
  }

  private dispatch(message: Message): void {
    if (message.type === MESSAGE.call) {
      this.onCall(message);
      return;
    }
    if (message.type !== MESSAGE.reply && message.type !== MESSAGE.error) return;
    const waiter = this.pending.get(message.replySerial ?? -1);
    if (!waiter) return;
    this.pending.delete(message.replySerial!);
    if (message.type === MESSAGE.reply) waiter.resolve(message.body ?? []);
    else waiter.reject(new DBusError(message.errorName ?? "", String(message.body?.[0] ?? "")));
  }
}
