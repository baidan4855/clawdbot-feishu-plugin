type WsHeader = {
  key: string;
  value: string;
};

export type WsFrame = {
  SeqID: bigint;
  LogID: bigint;
  service: number;
  method: number;
  headers?: WsHeader[];
  payloadEncoding?: string;
  payloadType?: string;
  payload?: Uint8Array;
  LogIDNew?: string;
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const WIRE_VARINT = 0;
const WIRE_LEN = 2;

const concatBuffers = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, item) => sum + item.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

const encodeVarint = (value: bigint): Uint8Array => {
  const bytes: number[] = [];
  let remaining = value;
  // Protobuf varint encoding (unsigned)
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return new Uint8Array(bytes);
};

const decodeVarint = (
  buffer: Uint8Array,
  offset: number,
): { value: bigint; offset: number } => {
  let result = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    result |= BigInt(byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) {
      return { value: result, offset: cursor };
    }
    shift += 7n;
  }
  throw new Error("Feishu WS proto: varint overflow");
};

const encodeTag = (fieldNumber: number, wireType: number): Uint8Array =>
  encodeVarint(BigInt((fieldNumber << 3) | wireType));

const encodeString = (value: string): Uint8Array => textEncoder.encode(value);

const decodeString = (value: Uint8Array): string => textDecoder.decode(value);

const readLengthDelimited = (
  buffer: Uint8Array,
  offset: number,
): { value: Uint8Array; offset: number } => {
  const lengthInfo = decodeVarint(buffer, offset);
  const length = Number(lengthInfo.value);
  const start = lengthInfo.offset;
  const end = start + length;
  if (end > buffer.length) {
    throw new Error("Feishu WS proto: length out of range");
  }
  return {
    value: buffer.slice(start, end),
    offset: end,
  };
};

const encodeHeader = (header: WsHeader): Uint8Array => {
  const chunks: Uint8Array[] = [];
  const keyBytes = encodeString(header.key);
  const valueBytes = encodeString(header.value);

  chunks.push(encodeTag(1, WIRE_LEN));
  chunks.push(encodeVarint(BigInt(keyBytes.length)));
  chunks.push(keyBytes);

  chunks.push(encodeTag(2, WIRE_LEN));
  chunks.push(encodeVarint(BigInt(valueBytes.length)));
  chunks.push(valueBytes);

  return concatBuffers(chunks);
};

const decodeHeader = (buffer: Uint8Array): WsHeader => {
  let offset = 0;
  let key = "";
  let value = "";
  while (offset < buffer.length) {
    const tagInfo = decodeVarint(buffer, offset);
    const tag = Number(tagInfo.value);
    offset = tagInfo.offset;
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;
    if (wireType === WIRE_LEN) {
      const field = readLengthDelimited(buffer, offset);
      offset = field.offset;
      if (fieldNumber === 1) {
        key = decodeString(field.value);
      } else if (fieldNumber === 2) {
        value = decodeString(field.value);
      }
      continue;
    }
    if (wireType === WIRE_VARINT) {
      const skipped = decodeVarint(buffer, offset);
      offset = skipped.offset;
      continue;
    }
    break;
  }
  return { key, value };
};

export const decodeFrame = (buffer: Uint8Array): WsFrame => {
  let offset = 0;
  const frame: WsFrame = {
    SeqID: 0n,
    LogID: 0n,
    service: 0,
    method: 0,
    headers: [],
  };
  while (offset < buffer.length) {
    const tagInfo = decodeVarint(buffer, offset);
    const tag = Number(tagInfo.value);
    offset = tagInfo.offset;
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;
    if (wireType === WIRE_VARINT) {
      const field = decodeVarint(buffer, offset);
      offset = field.offset;
      if (fieldNumber === 1) frame.SeqID = field.value;
      if (fieldNumber === 2) frame.LogID = field.value;
      if (fieldNumber === 3) frame.service = Number(field.value);
      if (fieldNumber === 4) frame.method = Number(field.value);
      continue;
    }
    if (wireType === WIRE_LEN) {
      const field = readLengthDelimited(buffer, offset);
      offset = field.offset;
      if (fieldNumber === 5) {
        frame.headers?.push(decodeHeader(field.value));
      } else if (fieldNumber === 6) {
        frame.payloadEncoding = decodeString(field.value);
      } else if (fieldNumber === 7) {
        frame.payloadType = decodeString(field.value);
      } else if (fieldNumber === 8) {
        frame.payload = field.value;
      } else if (fieldNumber === 9) {
        frame.LogIDNew = decodeString(field.value);
      }
      continue;
    }
    break;
  }
  return frame;
};

export const encodeFrame = (frame: WsFrame): Uint8Array => {
  const chunks: Uint8Array[] = [];

  chunks.push(encodeTag(1, WIRE_VARINT));
  chunks.push(encodeVarint(frame.SeqID));

  chunks.push(encodeTag(2, WIRE_VARINT));
  chunks.push(encodeVarint(frame.LogID));

  chunks.push(encodeTag(3, WIRE_VARINT));
  chunks.push(encodeVarint(BigInt(frame.service)));

  chunks.push(encodeTag(4, WIRE_VARINT));
  chunks.push(encodeVarint(BigInt(frame.method)));

  if (frame.headers?.length) {
    for (const header of frame.headers) {
      const headerBytes = encodeHeader(header);
      chunks.push(encodeTag(5, WIRE_LEN));
      chunks.push(encodeVarint(BigInt(headerBytes.length)));
      chunks.push(headerBytes);
    }
  }

  if (frame.payloadEncoding) {
    const bytes = encodeString(frame.payloadEncoding);
    chunks.push(encodeTag(6, WIRE_LEN));
    chunks.push(encodeVarint(BigInt(bytes.length)));
    chunks.push(bytes);
  }

  if (frame.payloadType) {
    const bytes = encodeString(frame.payloadType);
    chunks.push(encodeTag(7, WIRE_LEN));
    chunks.push(encodeVarint(BigInt(bytes.length)));
    chunks.push(bytes);
  }

  if (frame.payload) {
    chunks.push(encodeTag(8, WIRE_LEN));
    chunks.push(encodeVarint(BigInt(frame.payload.length)));
    chunks.push(frame.payload);
  }

  if (frame.LogIDNew) {
    const bytes = encodeString(frame.LogIDNew);
    chunks.push(encodeTag(9, WIRE_LEN));
    chunks.push(encodeVarint(BigInt(bytes.length)));
    chunks.push(bytes);
  }

  return concatBuffers(chunks);
};
