/**
 * 3D 파일 검사기 — 사용자가 공식 사이트에서 직접 내려받아 등록한
 * PLY/STL/ASC 파일의 품질 보고서를 생성한다. 원본은 수정하지 않는다.
 */
import type { QualityReport } from "@seokmun/types";

type BBox = { min: [number, number, number]; max: [number, number, number] };

function emptyBBox(): { bbox: BBox; touched: boolean } {
  return {
    bbox: {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    },
    touched: false,
  };
}

function extend(b: { bbox: BBox; touched: boolean }, x: number, y: number, z: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  b.touched = true;
  b.bbox.min[0] = Math.min(b.bbox.min[0], x);
  b.bbox.min[1] = Math.min(b.bbox.min[1], y);
  b.bbox.min[2] = Math.min(b.bbox.min[2], z);
  b.bbox.max[0] = Math.max(b.bbox.max[0], x);
  b.bbox.max[1] = Math.max(b.bbox.max[1], y);
  b.bbox.max[2] = Math.max(b.bbox.max[2], z);
}

function guessUnit(bbox: BBox | null, warnings: string[]): string | null {
  if (!bbox) {
    warnings.push("경계상자를 계산하지 못해 단위를 추정할 수 없음 — 사용자 확인 필요");
    return null;
  }
  const span = Math.max(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2]
  );
  if (span > 50) return "mm 추정 (사용자 확인 필요)";
  if (span >= 0.05 && span <= 10) return "m 추정 (사용자 확인 필요)";
  warnings.push("치수 범위가 일반적 비석 크기와 달라 단위 확인 필요");
  return null;
}

export function parsePly(buf: Buffer): QualityReport {
  const warnings: string[] = [];
  const headText = buf.subarray(0, Math.min(buf.length, 8192)).toString("latin1");
  if (!headText.startsWith("ply")) {
    return {
      format: "PLY",
      vertexCount: null,
      triangleCount: null,
      pointCount: null,
      hasNormals: null,
      hasColors: null,
      boundingBox: null,
      unitGuess: null,
      warnings: ["PLY 매직 헤더가 없음 — 파일 형식 확인 필요"],
    };
  }
  const headerEnd = headText.indexOf("end_header");
  const header = headerEnd >= 0 ? headText.slice(0, headerEnd) : headText;
  const vertexMatch = header.match(/element\s+vertex\s+(\d+)/);
  const faceMatch = header.match(/element\s+face\s+(\d+)/);
  const isAscii = /format\s+ascii/.test(header);
  const hasNormals = /property\s+\w+\s+nx/.test(header);
  const hasColors = /property\s+uchar\s+red/.test(header);
  const vertexCount = vertexMatch ? Number(vertexMatch[1]) : null;
  const faceCount = faceMatch ? Number(faceMatch[1]) : null;
  if (!hasNormals) warnings.push("법선(normal) 정보 없음 — 표면 분석 시 재계산 필요");
  if (faceCount === null || faceCount === 0)
    warnings.push("면(face) 정보 없음 — 점군으로 처리될 수 있음");

  let boundingBox: BBox | null = null;
  if (isAscii && headerEnd >= 0 && vertexCount) {
    const body = buf.toString("latin1");
    const lines = body
      .slice(body.indexOf("end_header") + "end_header".length)
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .slice(0, Math.min(vertexCount, 50000));
    const acc = emptyBBox();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/).map(Number);
      if (parts.length >= 3) extend(acc, parts[0]!, parts[1]!, parts[2]!);
    }
    boundingBox = acc.touched ? acc.bbox : null;
  } else if (!isAscii) {
    warnings.push("바이너리 PLY — P0 검사기는 헤더 통계만 제공 (변환은 P1)");
  }
  return {
    format: "PLY",
    vertexCount,
    triangleCount: faceCount,
    pointCount: faceCount === 0 ? vertexCount : null,
    hasNormals,
    hasColors,
    boundingBox,
    unitGuess: guessUnit(boundingBox, warnings),
    warnings,
  };
}

export function parseStl(buf: Buffer): QualityReport {
  const warnings: string[] = [];
  const head = buf.subarray(0, Math.min(buf.length, 512)).toString("latin1");
  const looksAscii = head.trimStart().toLowerCase().startsWith("solid") &&
    buf.toString("latin1", 0, Math.min(buf.length, 4096)).includes("facet");
  if (looksAscii) {
    const text = buf.toString("latin1");
    const facets = (text.match(/facet\s+normal/gi) ?? []).length;
    const acc = emptyBBox();
    const vertexRe = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = vertexRe.exec(text)) !== null && count < 150000) {
      extend(acc, Number(m[1]), Number(m[2]), Number(m[3]));
      count++;
    }
    const boundingBox = acc.touched ? acc.bbox : null;
    return {
      format: "STL(ASCII)",
      vertexCount: count,
      triangleCount: facets,
      pointCount: null,
      hasNormals: true,
      hasColors: false,
      boundingBox,
      unitGuess: guessUnit(boundingBox, warnings),
      warnings,
    };
  }
  if (buf.length < 84) {
    return {
      format: "STL",
      vertexCount: null,
      triangleCount: null,
      pointCount: null,
      hasNormals: null,
      hasColors: null,
      boundingBox: null,
      unitGuess: null,
      warnings: ["STL 파일이 너무 작음 — 손상 가능성"],
    };
  }
  const triangleCount = buf.readUInt32LE(80);
  const expected = 84 + triangleCount * 50;
  if (buf.length !== expected) {
    warnings.push(
      `파일 크기(${buf.length})가 삼각형 수(${triangleCount}) 기준 기대값(${expected})과 다름`
    );
  }
  const acc = emptyBBox();
  const maxTris = Math.min(triangleCount, 100000);
  for (let i = 0; i < maxTris; i++) {
    const base = 84 + i * 50;
    if (base + 48 > buf.length) break;
    for (let v = 0; v < 3; v++) {
      const off = base + 12 + v * 12;
      extend(acc, buf.readFloatLE(off), buf.readFloatLE(off + 4), buf.readFloatLE(off + 8));
    }
  }
  const boundingBox = acc.touched ? acc.bbox : null;
  return {
    format: "STL(binary)",
    vertexCount: triangleCount * 3,
    triangleCount,
    pointCount: null,
    hasNormals: true,
    hasColors: false,
    boundingBox,
    unitGuess: guessUnit(boundingBox, warnings),
    warnings,
  };
}

export function parseAsc(buf: Buffer): QualityReport {
  const warnings: string[] = [];
  const text = buf.toString("latin1");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const acc = emptyBBox();
  let pointCount = 0;
  let columns: number | null = null;
  for (const line of lines) {
    const parts = line.trim().split(/[\s,;]+/).map(Number);
    if (parts.length < 3 || parts.some((p) => !Number.isFinite(p))) continue;
    columns = columns ?? parts.length;
    extend(acc, parts[0]!, parts[1]!, parts[2]!);
    pointCount++;
    if (pointCount >= 500000) {
      warnings.push("점 50만 개 초과 — 표본 통계만 제공");
      break;
    }
  }
  if (pointCount === 0) warnings.push("유효한 xyz 점을 찾지 못함");
  const hasNormals = columns !== null && columns >= 6;
  const boundingBox = acc.touched ? acc.bbox : null;
  return {
    format: "ASC",
    vertexCount: null,
    triangleCount: null,
    pointCount,
    hasNormals,
    hasColors: columns !== null && columns >= 9,
    boundingBox,
    unitGuess: guessUnit(boundingBox, warnings),
    warnings,
  };
}

export function inspectUpload(filename: string, buf: Buffer): QualityReport {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "ply") return parsePly(buf);
  if (ext === "stl") return parseStl(buf);
  if (ext === "asc" || ext === "xyz" || ext === "txt") return parseAsc(buf);
  return {
    format: ext.toUpperCase() || "UNKNOWN",
    vertexCount: null,
    triangleCount: null,
    pointCount: null,
    hasNormals: null,
    hasColors: null,
    boundingBox: null,
    unitGuess: null,
    warnings: [
      `지원하지 않는 형식(${ext || "확장자 없음"}) — PLY/STL/ASC만 P0에서 검사 가능`,
    ],
  };
}
