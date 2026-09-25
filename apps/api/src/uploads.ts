/**
 * 스트리밍 업로드 — 본문을 메모리에 올리지 않고 디스크로 흘려 쓰며 sha256을 동시에 계산한다.
 * 형식별 검사는 크기에 따라 전체 파싱 / 헤더 전용 검사로 나눠 이벤트 루프를 오래 막지 않는다.
 */
import { createHash } from "node:crypto";
import { closeSync, createWriteStream, mkdirSync, openSync, readSync, renameSync, rmSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AssetType, QualityReport } from "@seokmun/types";
import { inspectUpload } from "@seokmun/engine";

export interface UploadKind {
  ext: string;
  assetType: AssetType;
  mimeType: string;
  /** 서버가 내용을 해석할 수 있는지 (아니면 원본 보존·다운로드 전용) */
  inspectable: boolean;
}

const KINDS: Record<string, Omit<UploadKind, "ext">> = {
  ply: { assetType: "MESH", mimeType: "application/octet-stream", inspectable: true },
  stl: { assetType: "MESH", mimeType: "model/stl", inspectable: true },
  obj: { assetType: "MESH", mimeType: "model/obj", inspectable: true },
  glb: { assetType: "MESH", mimeType: "model/gltf-binary", inspectable: false },
  asc: { assetType: "POINT_CLOUD", mimeType: "text/plain", inspectable: true },
  xyz: { assetType: "POINT_CLOUD", mimeType: "text/plain", inspectable: true },
  e57: { assetType: "POINT_CLOUD", mimeType: "application/octet-stream", inspectable: false },
  las: { assetType: "POINT_CLOUD", mimeType: "application/octet-stream", inspectable: false },
  jpg: { assetType: "IMAGE", mimeType: "image/jpeg", inspectable: true },
  jpeg: { assetType: "IMAGE", mimeType: "image/jpeg", inspectable: true },
  png: { assetType: "IMAGE", mimeType: "image/png", inspectable: true },
  webp: { assetType: "IMAGE", mimeType: "image/webp", inspectable: true },
  tif: { assetType: "IMAGE", mimeType: "image/tiff", inspectable: true },
  tiff: { assetType: "IMAGE", mimeType: "image/tiff", inspectable: true },
  ptm: { assetType: "RTI", mimeType: "application/octet-stream", inspectable: false },
  rti: { assetType: "RTI", mimeType: "application/octet-stream", inspectable: false },
  pdf: { assetType: "PDF", mimeType: "application/pdf", inspectable: true },
};

export const ALLOWED_UPLOAD_EXTENSIONS = Object.keys(KINDS);

export function uploadKind(filename: string, declared?: AssetType | null): UploadKind | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const k = KINDS[ext];
  if (!k) return null;
  // 이미지 중 탁본은 사용자가 지정 (자동 판별 불가)
  const assetType = declared === "RUBBING" && k.assetType === "IMAGE" ? "RUBBING" : k.assetType;
  return { ext, ...k, assetType };
}

export class UploadTooLargeError extends Error {
  statusCode = 413;
  code = "UPLOAD_TOO_LARGE";
}

/** 스트림을 임시 파일로 저장 → sha256·크기 계산 → 최종 경로로 원자적 이동 */
export async function saveStream(
  source: Readable,
  finalPath: string,
  maxBytes: number
): Promise<{ bytes: number; sha256: string }> {
  mkdirSync(path.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.part-${process.pid}-${Date.now()}`;
  const hash = createHash("sha256");
  let bytes = 0;
  let overflow = false;
  // 한도 초과 시 요청 스트림을 파괴하지 않고 나머지를 읽어 버린다 —
  // 스트림을 끊으면 413 응답조차 보낼 수 없기 때문 (길이를 모르는 청크 전송 대비)
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (overflow || bytes > maxBytes) {
        overflow = true;
        cb();
        return;
      }
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(source, meter, createWriteStream(tmpPath, { flags: "wx" }));
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }
  if (overflow) {
    rmSync(tmpPath, { force: true });
    throw new UploadTooLargeError(`업로드 한도(${Math.round(maxBytes / 1024 ** 2)}MB)를 넘었습니다`);
  }
  if (bytes === 0) {
    rmSync(tmpPath, { force: true });
    const e = new Error("빈 파일입니다") as Error & { statusCode: number; code: string };
    e.statusCode = 400;
    e.code = "EMPTY_BODY";
    throw e;
  }
  // 원본 불변 — 같은 경로가 이미 있으면 덮어쓰지 않는다
  try {
    statSync(finalPath);
    rmSync(tmpPath, { force: true });
    const e = new Error("같은 이름의 원본이 이미 있습니다") as Error & { statusCode: number; code: string };
    e.statusCode = 409;
    e.code = "ORIGINAL_EXISTS";
    throw e;
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT") throw err;
  }
  renameSync(tmpPath, finalPath);
  return { bytes, sha256: hash.digest("hex") };
}

function readHead(file: string, n: number): Buffer {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(n);
    const read = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** 이미지 헤더에서 픽셀 크기만 읽는다 (PNG/JPEG/WebP/TIFF) */
export function imageDimensions(head: Buffer): { width: number; height: number; format: string } | null {
  if (head.length > 24 && head.readUInt32BE(0) === 0x89504e47) {
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20), format: "PNG" };
  }
  if (head.length > 4 && head[0] === 0xff && head[1] === 0xd8) {
    let off = 2;
    while (off + 9 < head.length) {
      if (head[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = head[off + 1]!;
      const len = head.readUInt16BE(off + 2);
      // SOF0~SOF15 (DHT·JPG·DAC 제외)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: head.readUInt16BE(off + 5), width: head.readUInt16BE(off + 7), format: "JPEG" };
      }
      off += 2 + len;
    }
    return { width: 0, height: 0, format: "JPEG" };
  }
  if (head.length > 30 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") {
    const chunk = head.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return { width: 1 + head.readUIntLE(24, 3), height: 1 + head.readUIntLE(27, 3), format: "WEBP" };
    }
    if (chunk === "VP8 ") {
      return { width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff, format: "WEBP" };
    }
    if (chunk === "VP8L") {
      const b = head.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, format: "WEBP" };
    }
  }
  const tiffLE = head.toString("ascii", 0, 2) === "II";
  const tiffBE = head.toString("ascii", 0, 2) === "MM";
  if ((tiffLE || tiffBE) && head.length > 16) {
    const u16 = (o: number) => (tiffLE ? head.readUInt16LE(o) : head.readUInt16BE(o));
    const u32 = (o: number) => (tiffLE ? head.readUInt32LE(o) : head.readUInt32BE(o));
    const ifd = u32(4);
    if (ifd + 2 < head.length) {
      const n = u16(ifd);
      let width = 0;
      let height = 0;
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > head.length) break;
        const tag = u16(e);
        const type = u16(e + 2);
        const val = type === 3 ? u16(e + 8) : u32(e + 8);
        if (tag === 256) width = val;
        if (tag === 257) height = val;
      }
      return { width, height, format: "TIFF" };
    }
  }
  return null;
}

/** 대용량 메시·점군은 헤더만 보고 개수를 보고한다 (전체 파싱은 3D 업그레이드 잡에서) */
function headerOnlyMeshReport(ext: string, file: string, bytes: number): QualityReport {
  const head = readHead(file, 64 * 1024);
  const warnings = [
    `파일이 커서(${Math.round(bytes / 1024 ** 2)}MB) 업로드 시에는 헤더만 검사했습니다 — 경계상자·단위는 3D 업그레이드 작업에서 계산됩니다`,
  ];
  if (ext === "ply") {
    const text = head.toString("latin1");
    const end = text.indexOf("end_header");
    const header = end >= 0 ? text.slice(0, end) : text;
    const v = header.match(/element\s+vertex\s+(\d+)/);
    const f = header.match(/element\s+face\s+(\d+)/);
    return {
      format: "PLY",
      vertexCount: v ? Number(v[1]) : null,
      triangleCount: f ? Number(f[1]) : null,
      pointCount: null,
      hasNormals: /property\s+\w+\s+nx/.test(header),
      hasColors: /property\s+\w+\s+red/.test(header),
      boundingBox: null,
      unitGuess: null,
      warnings,
    };
  }
  if (ext === "stl" && !head.toString("latin1", 0, 5).toLowerCase().startsWith("solid")) {
    return {
      format: "STL",
      vertexCount: null,
      triangleCount: head.length >= 84 ? head.readUInt32LE(80) : null,
      pointCount: null,
      hasNormals: true,
      hasColors: false,
      boundingBox: null,
      unitGuess: null,
      warnings,
    };
  }
  return {
    format: ext.toUpperCase(),
    vertexCount: null,
    triangleCount: null,
    pointCount: null,
    hasNormals: null,
    hasColors: null,
    boundingBox: null,
    unitGuess: null,
    warnings,
  };
}

/** OBJ — 정점·면 수와 경계상자 (전체 파싱 대상 크기일 때) */
function inspectObj(buf: Buffer): QualityReport {
  const text = buf.toString("latin1");
  let v = 0;
  let f = 0;
  let hasNormals = false;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      v++;
      const p = line.trim().split(/\s+/).slice(1, 4).map(Number);
      for (let k = 0; k < 3; k++) {
        const c = p[k] ?? NaN;
        if (Number.isFinite(c)) {
          min[k] = Math.min(min[k]!, c);
          max[k] = Math.max(max[k]!, c);
        }
      }
    } else if (line.startsWith("vn ")) hasNormals = true;
    else if (line.startsWith("f ")) f += Math.max(1, line.trim().split(/\s+/).length - 3);
  }
  const bbox =
    v > 0
      ? { min: min as [number, number, number], max: max as [number, number, number] }
      : null;
  return {
    format: "OBJ",
    vertexCount: v,
    triangleCount: f,
    pointCount: null,
    hasNormals,
    hasColors: false,
    boundingBox: bbox,
    unitGuess: null,
    warnings: ["OBJ 단위는 파일에 기록되지 않습니다 — 단위·축척 확정이 필요합니다"],
  };
}

export interface InspectionResult {
  qualityReport: QualityReport;
  image: { width: number; height: number } | null;
}

export function inspectStoredFile(
  kind: UploadKind,
  file: string,
  bytes: number,
  fullParseMaxBytes: number
): InspectionResult {
  if (kind.assetType === "IMAGE" || kind.assetType === "RUBBING") {
    const dims = imageDimensions(readHead(file, 256 * 1024));
    const warnings: string[] = [];
    if (!dims) warnings.push("이미지 헤더를 해석하지 못했습니다 — 파일 형식을 확인하세요");
    if (dims?.format === "TIFF") {
      warnings.push("TIFF는 대부분의 브라우저가 직접 표시하지 못합니다 — 열람용 JPEG/PNG 파생본을 함께 올리세요");
    }
    return {
      qualityReport: {
        format: dims?.format ?? kind.ext.toUpperCase(),
        vertexCount: null,
        triangleCount: null,
        pointCount: null,
        hasNormals: null,
        hasColors: true,
        boundingBox: null,
        unitGuess: null,
        warnings,
      },
      image: dims ? { width: dims.width, height: dims.height } : null,
    };
  }
  if (kind.assetType === "PDF") {
    const head = readHead(file, 1024).toString("latin1");
    return {
      qualityReport: {
        format: "PDF",
        vertexCount: null,
        triangleCount: null,
        pointCount: null,
        hasNormals: null,
        hasColors: null,
        boundingBox: null,
        unitGuess: null,
        warnings: head.startsWith("%PDF")
          ? ["PDF 본문은 자동 추출하지 않습니다 — 인용할 문헌 텍스트는 문헌 등록 화면에 붙여 넣으세요"]
          : ["PDF 매직 헤더가 없습니다 — 파일을 확인하세요"],
      },
      image: null,
    };
  }
  if (!kind.inspectable) {
    return {
      qualityReport: {
        format: kind.ext.toUpperCase(),
        vertexCount: null,
        triangleCount: null,
        pointCount: null,
        hasNormals: null,
        hasColors: null,
        boundingBox: null,
        unitGuess: null,
        warnings: [
          `${kind.ext.toUpperCase()} 형식은 원본 보존·다운로드만 지원합니다 (서버 해석 미지원) — 열람하려면 PLY/OBJ/STL로 변환해 함께 올리세요`,
        ],
      },
      image: null,
    };
  }
  if (bytes > fullParseMaxBytes) {
    return { qualityReport: headerOnlyMeshReport(kind.ext, file, bytes), image: null };
  }
  const buf = readFileSync(file);
  const report = kind.ext === "obj" ? inspectObj(buf) : inspectUpload(`x.${kind.ext}`, buf);
  return { qualityReport: report, image: null };
}
