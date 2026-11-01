import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * 跨平台、无外部依赖的轻量标准 ZIP 打包与解析器
 * 满足完整实验档案的导出与校验导入需求
 */
export function createZip(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const filenameBuf = Buffer.from(file.name, 'utf8');
    const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const compressed = deflateRawSync(dataBuf);
    const useCompression = compressed.length < dataBuf.length;
    const finalData = useCompression ? compressed : dataBuf;
    const compressionMethod = useCompression ? 8 : 0;
    const crc = crc32(dataBuf);

    // Local file header (30 bytes + name + data)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Signature PK\x03\x04
    localHeader.writeUInt16LE(20, 4);        // Version needed
    localHeader.writeUInt16LE(0, 6);         // Flags
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(0, 10);        // Mod time
    localHeader.writeUInt16LE(0, 12);        // Mod date
    localHeader.writeUInt32LE(crc, 14);      // CRC32
    localHeader.writeUInt32LE(finalData.length, 18); // Compressed size
    localHeader.writeUInt32LE(dataBuf.length, 22);   // Uncompressed size
    localHeader.writeUInt16LE(filenameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);        // Extra length

    localHeaders.push(localHeader, filenameBuf, finalData);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Signature PK\x01\x02
    centralHeader.writeUInt16LE(20, 4);         // Version made by
    centralHeader.writeUInt16LE(20, 6);         // Version needed
    centralHeader.writeUInt16LE(0, 8);          // Flags
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(0, 12);         // Mod time
    centralHeader.writeUInt16LE(0, 14);         // Mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(finalData.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(filenameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);         // Extra field length
    centralHeader.writeUInt16LE(0, 32);         // File comment length
    centralHeader.writeUInt16LE(0, 34);         // Disk start
    centralHeader.writeUInt16LE(0, 36);         // Internal attr
    centralHeader.writeUInt32LE(0, 38);         // External attr
    centralHeader.writeUInt32LE(offset, 42);    // Local header offset

    centralHeaders.push(centralHeader, filenameBuf);
    offset += localHeader.length + filenameBuf.length + finalData.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((acc, b) => acc + b.length, 0);

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // Signature PK\x05\x06
  eocd.writeUInt16LE(0, 4);          // Disk number
  eocd.writeUInt16LE(0, 6);          // Start disk
  eocd.writeUInt16LE(files.length, 8); // Entries on this disk
  eocd.writeUInt16LE(files.length, 10); // Total entries
  eocd.writeUInt32LE(centralDirSize, 12); // Central dir size
  eocd.writeUInt32LE(centralDirOffset, 16); // Central dir offset
  eocd.writeUInt16LE(0, 20);         // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

export function parseZip(buffer) {
  const files = [];
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('无效的 ZIP 文件：缺少 EOCD 标识');

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  let currentCd = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(currentCd) !== 0x02014b50) throw new Error('损坏的 ZIP 目录结构');
    const method = buffer.readUInt16LE(currentCd + 10);
    const compressedSize = buffer.readUInt32LE(currentCd + 20);
    const uncompressedSize = buffer.readUInt32LE(currentCd + 24);
    const nameLen = buffer.readUInt16LE(currentCd + 28);
    const extraLen = buffer.readUInt16LE(currentCd + 30);
    const commentLen = buffer.readUInt16LE(currentCd + 32);
    const localOffset = buffer.readUInt32LE(currentCd + 42);

    const name = buffer.subarray(currentCd + 46, currentCd + 46 + nameLen).toString('utf8');

    // Read local header
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('损坏的 ZIP 本地文件头');
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const rawData = buffer.subarray(dataStart, dataStart + compressedSize);

    let data;
    if (method === 0) data = rawData;
    else if (method === 8) data = inflateRawSync(rawData);
    else throw new Error(`不支持的压缩算法: ${method}`);

    files.push({ name, data });
    currentCd += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// CRC32 计算实现
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
