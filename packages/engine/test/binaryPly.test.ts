import { describe, expect, it } from "vitest";
import { parsePlyToMesh } from "../src/meshIngest";

/** 테스트용 binary_little_endian PLY 생성 */
function makeBinaryPly({
  withColor = false,
  withNormal = false,
  quad = false,
  pentagon = false,
}: { withColor?: boolean; withNormal?: boolean; quad?: boolean; pentagon?: boolean } = {}): Buffer {
  const verts: number[][] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ];
  if (pentagon) verts.push([-0.5, 0.5, 0]);
  const props = ["property float x", "property float y", "property float z"];
  if (withNormal) props.push("property float nx", "property float ny", "property float nz");
  if (withColor) props.push("property uchar red", "property uchar green", "property uchar blue");
  const faces = pentagon
    ? [[0, 1, 2, 3, 4]]
    : quad
      ? [[0, 1, 2, 3]]
      : [[0, 1, 2], [0, 2, 3]];
  const header =
    `ply\nformat binary_little_endian 1.0\ncomment 가상 테스트 자산\n` +
    `element vertex ${verts.length}\n${props.join("\n")}\n` +
    `element face ${faces.length}\nproperty list uchar int vertex_indices\nend_header\n`;
  const parts: Buffer[] = [Buffer.from(header, "latin1")];
  for (const v of verts) {
    const b = Buffer.alloc(12 + (withNormal ? 12 : 0) + (withColor ? 3 : 0));
    let o = 0;
    b.writeFloatLE(v[0]!, o); o += 4;
    b.writeFloatLE(v[1]!, o); o += 4;
    b.writeFloatLE(v[2]!, o); o += 4;
    if (withNormal) { b.writeFloatLE(0, o); b.writeFloatLE(0, o + 4); b.writeFloatLE(1, o + 8); o += 12; }
    if (withColor) { b.writeUInt8(255, o); b.writeUInt8(128, o + 1); b.writeUInt8(0, o + 2); }
    parts.push(b);
  }
  for (const f of faces) {
    const b = Buffer.alloc(1 + f.length * 4);
    b.writeUInt8(f.length, 0);
    f.forEach((idx, i) => b.writeInt32LE(idx, 1 + i * 4));
    parts.push(b);
  }
  return Buffer.concat(parts);
}

describe("binary_little_endian PLY 파서", () => {
  it("정점·삼각형을 정확히 읽는다", () => {
    const mesh = parsePlyToMesh(makeBinaryPly());
    expect(mesh).not.toBeNull();
    expect(mesh!.arrays.vertexCount).toBe(4);
    expect(mesh!.arrays.triangleCount).toBe(2);
    expect(mesh!.arrays.positions[3]).toBeCloseTo(1);
    expect(mesh!.hadColors).toBe(false);
  });

  it("uchar 색상을 0–1로 정규화한다", () => {
    const mesh = parsePlyToMesh(makeBinaryPly({ withColor: true }));
    expect(mesh!.hadColors).toBe(true);
    expect(mesh!.arrays.colors[0]).toBeCloseTo(1);
    expect(mesh!.arrays.colors[1]).toBeCloseTo(128 / 255);
  });

  it("법선이 있으면 사용, 없으면 재계산 경고", () => {
    const withN = parsePlyToMesh(makeBinaryPly({ withNormal: true }));
    expect(withN!.hadNormals).toBe(true);
    expect(withN!.arrays.normals[2]).toBeCloseTo(1);
    const withoutN = parsePlyToMesh(makeBinaryPly());
    expect(withoutN!.hadNormals).toBe(false);
    expect(withoutN!.warnings.join()).toContain("법선 없음");
  });

  it("사각형 면을 삼각형 2개로 분해한다", () => {
    const mesh = parsePlyToMesh(makeBinaryPly({ quad: true }));
    expect(mesh!.arrays.triangleCount).toBe(2);
  });

  it("ASCII와 binary의 오각형을 같은 부채꼴 삼각형 3개로 분해한다", () => {
    const ascii = Buffer.from(
      [
        "ply", "format ascii 1.0", "element vertex 5",
        "property float x", "property float y", "property float z",
        "element face 1", "property list uchar int vertex_indices", "end_header",
        "0 0 0", "1 0 0", "1 1 0", "0 1 0", "-0.5 0.5 0",
        "5 0 1 2 3 4", "",
      ].join("\n"),
      "latin1"
    );
    const expected = [0, 1, 2, 0, 2, 3, 0, 3, 4];
    const asciiMesh = parsePlyToMesh(ascii);
    const binaryMesh = parsePlyToMesh(makeBinaryPly({ pentagon: true }));

    expect(Array.from(asciiMesh!.arrays.indices)).toEqual(expected);
    expect(Array.from(binaryMesh!.arrays.indices)).toEqual(expected);
    expect(asciiMesh!.arrays.triangleCount).toBe(3);
    expect(binaryMesh!.arrays.triangleCount).toBe(3);
  });

  it("다각형 삼각분할 누적 결과가 보수적 상한을 넘으면 중단한다", () => {
    const vertexLines = Array.from({ length: 256 }, (_, index) => `${index} 0 0`);
    const polygon = `256 ${Array.from({ length: 256 }, (_, index) => index).join(" ")}`;
    const faceLines = Array.from({ length: 1_970 }, () => polygon);
    const ply = Buffer.from(
      [
        "ply", "format ascii 1.0", "element vertex 256",
        "property float x", "property float y", "property float z",
        `element face ${faceLines.length}`,
        "property list uchar int vertex_indices", "end_header",
        ...vertexLines, ...faceLines, "",
      ].join("\n"),
      "latin1"
    );

    expect(parsePlyToMesh(ply)).toBeNull();
  });

  it("big_endian은 정직하게 null (미지원)", () => {
    const buf = makeBinaryPly();
    const swapped = Buffer.from(
      buf.toString("latin1").replace("binary_little_endian", "binary_big_endian"),
      "latin1"
    );
    expect(parsePlyToMesh(swapped)).toBeNull();
  });

  it("손상(잘린) 파일은 null", () => {
    const buf = makeBinaryPly();
    expect(parsePlyToMesh(buf.subarray(0, buf.length - 10))).toBeNull();
  });

  it("헤더의 비정상적으로 큰 정점·면 수를 할당 전에 거부한다", () => {
    const ascii = Buffer.from(
      "ply\nformat ascii 1.0\nelement vertex 1000001\nproperty float x\nproperty float y\nproperty float z\nend_header\n",
      "latin1"
    );
    const binary = Buffer.from(
      "ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nelement face 1000001\nproperty list uchar int vertex_indices\nend_header\n",
      "latin1"
    );
    expect(parsePlyToMesh(ascii)).toBeNull();
    expect(parsePlyToMesh(binary)).toBeNull();
  });

  it("유한하지 않은 좌표와 범위 밖 면 인덱스를 거부한다", () => {
    const invalidCoordinate = Buffer.from(
      "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\nNaN 0 0\n",
      "latin1"
    );
    const invalidIndex = Buffer.from(
      "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 3\n",
      "latin1"
    );
    expect(parsePlyToMesh(invalidCoordinate)).toBeNull();
    expect(parsePlyToMesh(invalidIndex)).toBeNull();
  });
});
