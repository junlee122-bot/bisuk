/** MeshArrays → GLB (KHR_mesh_quantization 양자화 압축) */
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import type { MeshArrays } from "@seokmun/engine";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

export async function meshArraysToGlb(
  arrays: MeshArrays,
  name: string,
  opts: { roughness?: number; quantized?: boolean } = {}
): Promise<Uint8Array> {
  const doc = new Document();
  doc.createBuffer();
  const position = doc
    .createAccessor("POSITION")
    .setType("VEC3")
    .setArray(Float32Array.from(arrays.positions));
  const normal = doc
    .createAccessor("NORMAL")
    .setType("VEC3")
    .setArray(Float32Array.from(arrays.normals));
  const color = doc
    .createAccessor("COLOR_0")
    .setType("VEC3")
    .setArray(Float32Array.from(arrays.colors));
  const indices = doc
    .createAccessor("indices")
    .setType("SCALAR")
    .setArray(Uint32Array.from(arrays.indices));
  const material = doc
    .createMaterial("stone")
    .setMetallicFactor(0)
    .setRoughnessFactor(opts.roughness ?? 0.85)
    .setBaseColorFactor([1, 1, 1, 1])
    .setDoubleSided(false);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setAttribute("NORMAL", normal)
    .setAttribute("COLOR_0", color)
    .setIndices(indices)
    .setMaterial(material);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  const node = doc.createNode(name).setMesh(mesh);
  doc.createScene(name).addChild(node);
  if (opts.quantized !== false) {
    // The transform package loads optional image codecs (including sharp).
    // Keep it out of the API startup path so lightweight endpoints such as
    // /health do not require native image binaries to be initialized.
    const { quantize } = await import("@gltf-transform/functions");
    await doc.transform(
      quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8 })
    );
  }
  return io.writeBinary(doc);
}
