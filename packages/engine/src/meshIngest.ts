/**
 * 업로드 메시 전체 파싱(ASCII PLY / STL) + 정점 클러스터링 간소화.
 * 원본은 절대 수정하지 않으며 파생 배열만 생성한다.
 */
import type { MeshArrays } from "./meshBuild";

function computeBounds(positions: Float32Array) {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

/** 인접 삼각형 평균으로 정점 법선 계산 */
export function computeVertexNormals(
  positions: Float32Array,
  indices: Uint32Array
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    const abx = positions[b]! - positions[a]!;
    const aby = positions[b + 1]! - positions[a + 1]!;
    const abz = positions[b + 2]! - positions[a + 2]!;
    const acx = positions[c]! - positions[a]!;
    const acy = positions[c + 1]! - positions[a + 1]!;
    const acz = positions[c + 2]! - positions[a + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const idx of [a, b, c]) {
      normals[idx] = normals[idx]! + nx;
      normals[idx + 1] = normals[idx + 1]! + ny;
      normals[idx + 2] = normals[idx + 2]! + nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
    normals[i] = normals[i]! / len;
    normals[i + 1] = normals[i + 1]! / len;
    normals[i + 2] = normals[i + 2]! / len;
  }
  return normals;
}

export interface ParsedMesh {
  arrays: MeshArrays;
  hadNormals: boolean;
  hadColors: boolean;
  warnings: string[];
}

/** PLY 스칼라 타입 → 바이트 크기 */
const PLY_TYPE_SIZE: Record<string, number> = {
  char: 1, int8: 1, uchar: 1, uint8: 1,
  short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8,
};

function readPlyScalar(buf: Buffer, offset: number, type: string): number {
  switch (type) {
    case "char": case "int8": return buf.readInt8(offset);
    case "uchar": case "uint8": return buf.readUInt8(offset);
    case "short": case "int16": return buf.readInt16LE(offset);
    case "ushort": case "uint16": return buf.readUInt16LE(offset);
    case "int": case "int32": return buf.readInt32LE(offset);
    case "uint": case "uint32": return buf.readUInt32LE(offset);
    case "float": case "float32": return buf.readFloatLE(offset);
    case "double": case "float64": return buf.readDoubleLE(offset);
    default: return NaN;
  }
}

/** binary_little_endian PLY 파싱 (P1 부채 해소 — big_endian은 지원하지 않고 null 반환) */
function parseBinaryPlyToMesh(buf: Buffer): ParsedMesh | null {
  const headText = buf.toString("latin1", 0, Math.min(buf.length, 8192));
  const endIdx = headText.indexOf("end_header");
  if (endIdx < 0) return null;
  // end_header 라인 끝(개행 포함) 뒤부터 바이너리 본문
  const bodyStart = headText.indexOf("\n", endIdx) + 1;
  if (bodyStart <= 0) return null;
  const header = headText.slice(0, endIdx);

  // element 블록별 property 목록 수집
  interface Prop { name: string; type: string; isList: boolean; countType?: string; itemType?: string }
  const elements: Array<{ name: string; count: number; props: Prop[] }> = [];
  for (const line of header.split(/\r?\n/)) {
    const el = line.match(/^element\s+(\S+)\s+(\d+)/);
    if (el) {
      elements.push({ name: el[1]!, count: Number(el[2]), props: [] });
      continue;
    }
    const list = line.match(/^property\s+list\s+(\S+)\s+(\S+)\s+(\S+)/);
    if (list && elements.length) {
      elements[elements.length - 1]!.props.push({
        name: list[3]!, type: "list", isList: true, countType: list[1]!, itemType: list[2]!,
      });
      continue;
    }
    const scalar = line.match(/^property\s+(\S+)\s+(\S+)/);
    if (scalar && elements.length) {
      elements[elements.length - 1]!.props.push({ name: scalar[2]!, type: scalar[1]!, isList: false });
    }
  }
  const vertexEl = elements.find((e) => e.name === "vertex");
  if (!vertexEl) return null;

  const warnings: string[] = [];
  const positions = new Float32Array(vertexEl.count * 3);
  const hasNormal = vertexEl.props.some((p) => p.name === "nx");
  const hasColor = vertexEl.props.some((p) => p.name === "red");
  const normalsRaw = hasNormal ? new Float32Array(vertexEl.count * 3) : null;
  const colors = new Float32Array(vertexEl.count * 3).fill(0.62);
  let triList: number[] = [];

  let off = bodyStart;
  try {
    for (const el of elements) {
      if (el.name === "vertex") {
        for (let i = 0; i < el.count; i++) {
          const values: Record<string, number> = {};
          for (const p of el.props) {
            if (p.isList) return null; // 정점에 list 속성 — 미지원
            const size = PLY_TYPE_SIZE[p.type];
            if (!size) return null;
            values[p.name] = readPlyScalar(buf, off, p.type);
            off += size;
          }
          positions[i * 3] = values.x ?? 0;
          positions[i * 3 + 1] = values.y ?? 0;
          positions[i * 3 + 2] = values.z ?? 0;
          if (normalsRaw) {
            normalsRaw[i * 3] = values.nx ?? 0;
            normalsRaw[i * 3 + 1] = values.ny ?? 0;
            normalsRaw[i * 3 + 2] = values.nz ?? 0;
          }
          if (hasColor) {
            colors[i * 3] = (values.red ?? 158) / 255;
            colors[i * 3 + 1] = (values.green ?? 158) / 255;
            colors[i * 3 + 2] = (values.blue ?? 158) / 255;
          }
        }
      } else if (el.name === "face") {
        const listProp = el.props.find((p) => p.isList);
        if (!listProp) return null;
        const countSize = PLY_TYPE_SIZE[listProp.countType!]!;
        const itemSize = PLY_TYPE_SIZE[listProp.itemType!]!;
        for (let f = 0; f < el.count; f++) {
          const n = readPlyScalar(buf, off, listProp.countType!);
          off += countSize;
          const idx: number[] = [];
          for (let k = 0; k < n; k++) {
            idx.push(readPlyScalar(buf, off, listProp.itemType!));
            off += itemSize;
          }
          if (n === 3) triList.push(idx[0]!, idx[1]!, idx[2]!);
          else if (n === 4) triList.push(idx[0]!, idx[1]!, idx[2]!, idx[0]!, idx[2]!, idx[3]!);
        }
      } else {
        // 알 수 없는 element — list 없는 고정 크기만 건너뛸 수 있음
        const rowSize = el.props.reduce((s, p) => s + (p.isList ? NaN : (PLY_TYPE_SIZE[p.type] ?? NaN)), 0);
        if (Number.isNaN(rowSize)) return null;
        off += rowSize * el.count;
        warnings.push(`element ${el.name} ${el.count}개 건너뜀`);
      }
    }
  } catch {
    return null; // 버퍼 범위 초과 등 — 손상 파일
  }

  const indices = new Uint32Array(triList);
  const hadNormals = Boolean(normalsRaw && normalsRaw.some((v) => v !== 0));
  const normals = hadNormals ? normalsRaw! : computeVertexNormals(positions, indices);
  if (!hadNormals) warnings.push("원본에 법선 없음 — 파생 메시에서 재계산됨");
  if (triList.length === 0) warnings.push("면 정보 없음 — 점군으로 취급 권장");
  return {
    arrays: {
      positions,
      normals,
      colors,
      indices,
      bounds: computeBounds(positions),
      vertexCount: vertexEl.count,
      triangleCount: indices.length / 3,
    },
    hadNormals,
    hadColors: hasColor,
    warnings,
  };
}

/** PLY 전체 파싱 — ASCII 및 binary_little_endian (big_endian 미지원 → null) */
export function parsePlyToMesh(buf: Buffer): ParsedMesh | null {
  const head = buf.toString("latin1", 0, Math.min(buf.length, 256));
  if (!head.startsWith("ply")) return null;
  if (/format\s+binary_little_endian/.test(head)) return parseBinaryPlyToMesh(buf);
  if (/format\s+binary_big_endian/.test(head)) return null;
  const text = buf.toString("latin1");
  if (!/format\s+ascii/.test(text.slice(0, 200))) return null;
  const headerEnd = text.indexOf("end_header");
  if (headerEnd < 0) return null;
  const header = text.slice(0, headerEnd);
  const vertexMatch = header.match(/element\s+vertex\s+(\d+)/);
  const faceMatch = header.match(/element\s+face\s+(\d+)/);
  if (!vertexMatch) return null;
  const vertexCount = Number(vertexMatch[1]);
  const faceCount = faceMatch ? Number(faceMatch[1]) : 0;

  // 정점 속성 순서 파악
  const propLines = [...header.matchAll(/property\s+\S+\s+(\S+)/g)].map((m) => m[1]!);
  const vertexProps = propLines.filter((p) => p !== "vertex_indices" && p !== "vertex_index");
  const xi = vertexProps.indexOf("x");
  const nxi = vertexProps.indexOf("nx");
  const ri = vertexProps.indexOf("red");
  if (xi < 0) return null;

  const body = text.slice(headerEnd + "end_header".length).trim().split(/\r?\n/);
  const warnings: string[] = [];
  const positions = new Float32Array(vertexCount * 3);
  const normalsRaw = nxi >= 0 ? new Float32Array(vertexCount * 3) : null;
  const colors = new Float32Array(vertexCount * 3).fill(0.62);
  for (let i = 0; i < vertexCount; i++) {
    const parts = (body[i] ?? "").trim().split(/\s+/).map(Number);
    positions[i * 3] = parts[xi] ?? 0;
    positions[i * 3 + 1] = parts[xi + 1] ?? 0;
    positions[i * 3 + 2] = parts[xi + 2] ?? 0;
    if (normalsRaw && parts[nxi] !== undefined) {
      normalsRaw[i * 3] = parts[nxi]!;
      normalsRaw[i * 3 + 1] = parts[nxi + 1] ?? 0;
      normalsRaw[i * 3 + 2] = parts[nxi + 2] ?? 0;
    }
    if (ri >= 0 && parts[ri] !== undefined) {
      colors[i * 3] = (parts[ri] ?? 158) / 255;
      colors[i * 3 + 1] = (parts[ri + 1] ?? 158) / 255;
      colors[i * 3 + 2] = (parts[ri + 2] ?? 158) / 255;
    }
  }
  const triList: number[] = [];
  for (let f = 0; f < faceCount; f++) {
    const parts = (body[vertexCount + f] ?? "").trim().split(/\s+/).map(Number);
    const n = parts[0] ?? 0;
    if (n === 3) triList.push(parts[1]!, parts[2]!, parts[3]!);
    else if (n === 4) {
      triList.push(parts[1]!, parts[2]!, parts[3]!, parts[1]!, parts[3]!, parts[4]!);
    }
  }
  const indices = new Uint32Array(triList);
  const hadNormals = Boolean(normalsRaw);
  const normals =
    normalsRaw && normalsRaw.some((v) => v !== 0)
      ? normalsRaw
      : computeVertexNormals(positions, indices);
  if (!hadNormals) warnings.push("원본에 법선 없음 — 파생 메시에서 재계산됨");
  if (faceCount === 0) warnings.push("면 정보 없음 — 점군으로 취급 권장");
  return {
    arrays: {
      positions,
      normals,
      colors,
      indices,
      bounds: computeBounds(positions),
      vertexCount,
      triangleCount: indices.length / 3,
    },
    hadNormals,
    hadColors: ri >= 0,
    warnings,
  };
}

/** 바이너리/ASCII STL 전체 파싱 (정점 중복 통합) */
export function parseStlToMesh(buf: Buffer): ParsedMesh | null {
  const head = buf.subarray(0, 512).toString("latin1");
  const isAscii =
    head.trimStart().toLowerCase().startsWith("solid") &&
    buf.toString("latin1", 0, Math.min(buf.length, 4096)).includes("facet");
  const verts: number[] = [];
  if (isAscii) {
    const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    const text = buf.toString("latin1");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      verts.push(Number(m[1]), Number(m[2]), Number(m[3]));
    }
  } else {
    if (buf.length < 84) return null;
    const triangleCount = buf.readUInt32LE(80);
    for (let i = 0; i < triangleCount; i++) {
      const base = 84 + i * 50;
      if (base + 48 > buf.length) break;
      for (let v = 0; v < 3; v++) {
        const off = base + 12 + v * 12;
        verts.push(buf.readFloatLE(off), buf.readFloatLE(off + 4), buf.readFloatLE(off + 8));
      }
    }
  }
  if (verts.length < 9) return null;
  // 정점 중복 통합
  const map = new Map<string, number>();
  const positionsList: number[] = [];
  const indices = new Uint32Array(verts.length / 3);
  for (let i = 0; i < verts.length / 3; i++) {
    const x = verts[i * 3]!;
    const y = verts[i * 3 + 1]!;
    const z = verts[i * 3 + 2]!;
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = positionsList.length / 3;
      positionsList.push(x, y, z);
      map.set(key, idx);
    }
    indices[i] = idx;
  }
  const positions = new Float32Array(positionsList);
  const normals = computeVertexNormals(positions, indices);
  const colors = new Float32Array(positions.length).fill(0.62);
  return {
    arrays: {
      positions,
      normals,
      colors,
      indices,
      bounds: computeBounds(positions),
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
    },
    hadNormals: false,
    hadColors: false,
    warnings: ["STL은 법선을 면 단위로만 담으므로 정점 법선을 재계산함"],
  };
}

/**
 * 정점 클러스터링 간소화 — 격자 셀 단위로 정점을 병합한다.
 * 단순·결정적이며 오차 상한은 셀 대각선 길이다 (quadric 간소화는 P1).
 */
export function vertexClusterDecimate(
  mesh: MeshArrays,
  targetTriangles: number
): { arrays: MeshArrays; cellSize: number } {
  if (mesh.triangleCount <= targetTriangles) {
    return { arrays: mesh, cellSize: 0 };
  }
  const { bounds } = mesh;
  const span = Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2]
  );
  // 목표 삼각형 수에 맞는 격자 해상도 추정 (표면 ∝ n^2)
  let n = Math.max(8, Math.round(Math.sqrt(targetTriangles / 2) * 1.6));
  for (let attempt = 0; attempt < 5; attempt++) {
    const cellSize = span / n;
    const clusterOf = new Map<string, number>();
    const repPos: number[] = [];
    const repCol: number[] = [];
    const repCount: number[] = [];
    const vertexCluster = new Uint32Array(mesh.vertexCount);
    for (let i = 0; i < mesh.vertexCount; i++) {
      const x = mesh.positions[i * 3]!;
      const y = mesh.positions[i * 3 + 1]!;
      const z = mesh.positions[i * 3 + 2]!;
      const key = `${Math.floor((x - bounds.min[0]) / cellSize)},${Math.floor((y - bounds.min[1]) / cellSize)},${Math.floor((z - bounds.min[2]) / cellSize)}`;
      let cid = clusterOf.get(key);
      if (cid === undefined) {
        cid = repPos.length / 3;
        clusterOf.set(key, cid);
        repPos.push(0, 0, 0);
        repCol.push(0, 0, 0);
        repCount.push(0);
      }
      vertexCluster[i] = cid;
      repPos[cid * 3] = repPos[cid * 3]! + x;
      repPos[cid * 3 + 1] = repPos[cid * 3 + 1]! + y;
      repPos[cid * 3 + 2] = repPos[cid * 3 + 2]! + z;
      repCol[cid * 3] = repCol[cid * 3]! + mesh.colors[i * 3]!;
      repCol[cid * 3 + 1] = repCol[cid * 3 + 1]! + mesh.colors[i * 3 + 1]!;
      repCol[cid * 3 + 2] = repCol[cid * 3 + 2]! + mesh.colors[i * 3 + 2]!;
      repCount[cid] = repCount[cid]! + 1;
    }
    const triList: number[] = [];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = vertexCluster[mesh.indices[t]!]!;
      const b = vertexCluster[mesh.indices[t + 1]!]!;
      const c = vertexCluster[mesh.indices[t + 2]!]!;
      if (a !== b && b !== c && a !== c) triList.push(a, b, c);
    }
    if (triList.length / 3 <= targetTriangles * 1.3 || attempt === 4) {
      const count = repPos.length / 3;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const k = repCount[i]!;
        positions[i * 3] = repPos[i * 3]! / k;
        positions[i * 3 + 1] = repPos[i * 3 + 1]! / k;
        positions[i * 3 + 2] = repPos[i * 3 + 2]! / k;
        colors[i * 3] = repCol[i * 3]! / k;
        colors[i * 3 + 1] = repCol[i * 3 + 1]! / k;
        colors[i * 3 + 2] = repCol[i * 3 + 2]! / k;
      }
      const indices = new Uint32Array(triList);
      return {
        arrays: {
          positions,
          normals: computeVertexNormals(positions, indices),
          colors,
          indices,
          bounds: computeBounds(positions),
          vertexCount: count,
          triangleCount: indices.length / 3,
        },
        cellSize,
      };
    }
    n = Math.round(n * 0.75);
  }
  return { arrays: mesh, cellSize: 0 };
}
