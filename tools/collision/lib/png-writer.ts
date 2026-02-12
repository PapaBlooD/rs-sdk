// Shared PNG writer — no external deps, pure Node zlib
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

function crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeChunk(type: string, data: Uint8Array): Uint8Array {
    const chunk = new Uint8Array(4 + 4 + data.length + 4);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(data, 8);
    const crcData = new Uint8Array(4 + data.length);
    for (let i = 0; i < 4; i++) crcData[i] = type.charCodeAt(i);
    crcData.set(data, 4);
    dv.setUint32(8 + data.length, crc32(crcData));
    return chunk;
}

export function writePNG(path: string, width: number, height: number, rgb: Uint8Array) {
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = new Uint8Array(13);
    const ihdrView = new DataView(ihdr.buffer);
    ihdrView.setUint32(0, width);
    ihdrView.setUint32(4, height);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

    const rowBytes = 1 + width * 3;
    const rawData = new Uint8Array(height * rowBytes);
    for (let y = 0; y < height; y++) {
        rawData[y * rowBytes] = 0; // filter: None
        rawData.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * rowBytes + 1);
    }
    const compressed = deflateSync(Buffer.from(rawData), { level: 9 });

    const ihdrChunk = writeChunk('IHDR', ihdr);
    const idatChunk = writeChunk('IDAT', new Uint8Array(compressed));
    const iendChunk = writeChunk('IEND', new Uint8Array(0));

    const png = new Uint8Array(signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
    let pos = 0;
    png.set(signature, pos); pos += signature.length;
    png.set(ihdrChunk, pos); pos += ihdrChunk.length;
    png.set(idatChunk, pos); pos += idatChunk.length;
    png.set(iendChunk, pos);

    writeFileSync(path, png);
    console.log(`Written ${path} (${(png.length / 1024).toFixed(0)} KB, ${width}x${height})`);
}
