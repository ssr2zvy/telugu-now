const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

export interface StoredZipEntry {
  name: string;
  data: Uint8Array | string;
}

function bytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

function crc32(value: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function uint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function createStoredZip(entries: readonly StoredZipEntry[]): Uint8Array<ArrayBuffer> {
  if (entries.length === 0 || entries.length > 0xffff) throw new Error('Invalid ZIP entry count.');
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = bytes(entry.name);
    const data = bytes(entry.data);
    if (!entry.name || entry.name.startsWith('/') || entry.name.includes('\\')
      || name.length > 0xffff || data.length > 0xffffffff) {
      throw new Error(`Invalid ZIP entry: ${entry.name}`);
    }
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    uint32(localView, 0, 0x04034b50);
    uint16(localView, 4, 20);
    uint16(localView, 6, UTF8_FLAG);
    uint16(localView, 8, STORE_METHOD);
    uint16(localView, 10, DOS_TIME);
    uint16(localView, 12, DOS_DATE);
    uint32(localView, 14, checksum);
    uint32(localView, 18, data.length);
    uint32(localView, 22, data.length);
    uint16(localView, 26, name.length);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    uint32(centralView, 0, 0x02014b50);
    uint16(centralView, 4, 20);
    uint16(centralView, 6, 20);
    uint16(centralView, 8, UTF8_FLAG);
    uint16(centralView, 10, STORE_METHOD);
    uint16(centralView, 12, DOS_TIME);
    uint16(centralView, 14, DOS_DATE);
    uint32(centralView, 16, checksum);
    uint32(centralView, 20, data.length);
    uint32(centralView, 24, data.length);
    uint16(centralView, 28, name.length);
    uint32(centralView, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }

  const centralDirectory = concatenate(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  uint32(endView, 0, 0x06054b50);
  uint16(endView, 8, entries.length);
  uint16(endView, 10, entries.length);
  uint32(endView, 12, centralDirectory.length);
  uint32(endView, 16, localOffset);
  return concatenate([...localParts, centralDirectory, end]);
}
