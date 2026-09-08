const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
export interface StoredZipEntry {
  name: string;
  data: Uint8Array | string;
}
function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
function asBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? utf8(value) : value;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}
function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}
function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
export function createStoredZip(entries: readonly StoredZipEntry[]): Uint8Array {
  if (entries.length === 0) {
    throw new Error('ZIP archive must contain at least one entry.');
  }
  if (entries.length > 0xffff) {
    throw new Error('ZIP64 is not supported.');
  }
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('/') || entry.name.includes('\\')) {
      throw new Error(`Invalid ZIP entry name: ${entry.name}`);
    }
    const nameBytes = utf8(entry.name);
    const data = asBytes(entry.data);
    if (nameBytes.length > 0xffff) {
      throw new Error(`ZIP entry name is too long: ${entry.name}`);
    }
    if (data.length > 0xffffffff) {
      throw new Error(`ZIP64 is required for entry: ${entry.name}`);
    }
    const checksum = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, UTF8_FLAG);
    writeUint16(localView, 8, STORE_METHOD);
    writeUint16(localView, 10, DOS_TIME);
    writeUint16(localView, 12, DOS_DATE);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, data.length);
    writeUint32(localView, 22, data.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, UTF8_FLAG);
    writeUint16(centralView, 10, STORE_METHOD);
    writeUint16(centralView, 12, DOS_TIME);
    writeUint16(centralView, 14, DOS_DATE);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, data.length);
    writeUint32(centralView, 24, data.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + data.length;
    if (localOffset > 0xffffffff) {
      throw new Error('ZIP64 is required for this archive.');
    }
  }
  const centralDirectory = concatenate(centralParts);
  if (centralDirectory.length > 0xffffffff) {
    throw new Error('ZIP64 is required for this archive.');
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralDirectory.length);
  writeUint32(endView, 16, localOffset);
  writeUint16(endView, 20, 0);
  return concatenate([...localParts, centralDirectory, end]);
}
