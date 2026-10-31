import { deflateSync, inflateSync } from "node:zlib";
import { ImageCardError } from "./config.mjs";

const signature = Buffer.from([137,80,78,71,13,10,26,10]);
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
export function validatePng(bytes) {
  const invalid = () => { throw new ImageCardError("INVALID_IMAGE", "返回数据不是完整、可解码的 PNG 图片。"); };
  if (bytes.length < 57 || bytes.length > 20 * 1024 * 1024 || !bytes.subarray(0,8).equals(signature)) invalid();
  let offset = 8, header, ended = false; const data = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + 12 + length > bytes.length) invalid();
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) invalid();
    if (offset === 8 && type !== "IHDR") invalid();
    if (type === "IHDR") { if (header || length !== 13) invalid(); header = payload; }
    if (type === "IDAT") data.push(payload);
    offset += length + 12;
    if (type === "IEND") { if (length !== 0) invalid(); ended = true; break; }
  }
  if (!header || !ended || offset !== bytes.length || !data.length) invalid();
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), depth = header[8], color = header[9];
  const channels = {0:1,2:3,4:2,6:4}[color];
  // Qwen returns non-interlaced RGB/RGBA PNG. Reject unsupported data instead of accepting signatures only.
  if (!width || !height || width > 4096 || height > 4096 || width * height > 2048 ** 2 || depth !== 8 || !channels || header[10] || header[11] || header[12]) invalid();
  const stride = width * channels + 1, expected = stride * height;
  let decoded; try { decoded = inflateSync(Buffer.concat(data), { maxOutputLength: expected }); } catch { invalid(); }
  if (decoded.length !== expected) invalid();
  for (let row = 0; row < height; row++) if (decoded[row * stride] > 4) invalid();
  return { width, height, aspectRatio: width / height, mimeType: "image/png" };
}
// Hand-drawn deterministic fixture, never described as AI output; no diary text embedded.
export function mockPng(width, height) {
  const bytes = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = Math.floor(x / width * 128), v = Math.floor(y / height * 128);
    let c = [232,240,225];
    if (v > 78 && v < 114 && u > 10 && u < 118) c = [174,198,146];
    if (u > 25 && u < 103 && v > 44 && v < 89) c = [231,205,162];
    if (u > 20 && u < 108 && v > 35 && v < 47) c = ((u >> 3) % 2) ? [115,146,126] : [238,218,182];
    if (u > 34 && u < 60 && v > 55 && v < 76) c = [155,190,186];
    if (u > 74 && u < 92 && v > 58 && v < 89) c = [121,147,133];
    if (u > 31 && u < 70 && v > 83 && v < 90) c = [146,111,85];
    if (u > 44 && u < 60 && v > 75 && v < 84) c = [85,112,112];
    const pos = y * (width * 3 + 1) + 1 + x * 3;
    bytes.set(c, pos);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=2;
  return Buffer.concat([signature,chunk("IHDR",header),chunk("IDAT",deflateSync(bytes)),chunk("IEND",Buffer.alloc(0))]);
}
