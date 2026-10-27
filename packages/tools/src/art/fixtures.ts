// Small compressed models the client's tests load (P1.E14.T12), made with the export's own geometry step:
//   pnpm exec tsx packages/tools/src/art/fixtures.ts   → packages/client/src/gameplay/fixtures/*.glb
// creature.glb and flora.glb carry the vertex rig and colour masks their families' client code reads, compressed with
// those families' settings (families.json: unquantized); hull.glb is quantized as hulls are; textured.glb has a KTX2
// colour map (ETC1S) and normal map (UASTC) and meshopt geometry, for the browser test of the transcoder path.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Document, Logger, type Mesh } from '@gltf-transform/core';
import { KHRTextureBasisu } from '@gltf-transform/extensions';
import { ensureKtx } from './ktx.ts';
import { compressDocument, meshoptIO, type MeshoptOptions } from './meshopt.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const FIXTURES = join(ROOT, 'packages/client/src/gameplay/fixtures');

/** What the client tests expect of the fixtures. */
export const EXPECT = {
  /** creature's quad_grazer_0: local box, node translation, the `_pivot` value (Blender axes) and its world place */
  creature: { min: [2.4, 0, -0.3], max: [3.6, 1.2, 0.3], translation: [1, 0, 0], pivot: [3.3, 0.1, 1.2], pivotWorld: [4.3, 1.2, -0.1] },
  /** flora's bush_0 */
  flora: { min: [-0.5, 0, -0.5], max: [0.5, 1.5, 0.5], translation: [0, 0, 2] },
  /** hull's hull_0: a box away from the origin, as the reviewer's 2.4-3.6 wrapped */
  hull: { min: [2.4, 0.5, -1], max: [3.6, 1.5, 1], translation: [0, 0, 0] },
};

/** A box (24 vertices) from `min` to `max` with normals, UVs and extra attributes. */
function box(
  doc: Document,
  name: string,
  min: number[],
  max: number[],
  extra: Record<string, { type: 'SCALAR' | 'VEC3' | 'VEC4'; value: number[] }> = {},
): Mesh {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let axis = 0; axis < 3; axis++)
    for (const side of [0, 1]) {
      const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
      const base = pos.length / 3;
      for (const [a, b] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]) {
        const p = [0, 0, 0];
        p[axis] = side ? max[axis]! : min[axis]!;
        p[u] = a ? max[u]! : min[u]!;
        p[v] = b ? max[v]! : min[v]!;
        pos.push(...p);
        const n = [0, 0, 0];
        n[axis] = side ? 1 : -1;
        nrm.push(...n);
        uv.push(a, b);
      }
      idx.push(...(side ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
    }
  const count = pos.length / 3;
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer));
  for (const [semantic, { type, value }] of Object.entries(extra)) {
    const arr = new Float32Array(count * value.length);
    for (let i = 0; i < count; i++) arr.set(value, i * value.length);
    prim.setAttribute(semantic, doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer));
  }
  return doc.createMesh(name).addPrimitive(prim.setMaterial(doc.createMaterial(name)));
}

function scene(doc: Document, name: string, mesh: Mesh, translation: number[]): void {
  doc.createScene().addChild(
    doc
      .createNode(name)
      .setMesh(mesh)
      .setTranslation(translation as [number, number, number]),
  );
}

async function write(doc: Document, file: string, options: Partial<MeshoptOptions>): Promise<void> {
  await compressDocument(doc.setLogger(new Logger(Logger.Verbosity.WARN)), options);
  writeFileSync(join(FIXTURES, file), await (await meshoptIO()).writeBinary(doc));
}

/** A size × size RGB PNG filled by `px(x, y)`. */
function png(size: number, px: (x: number, y: number) => [number, number, number]): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw.set(px(x, y), y * (size * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]),
  );
}

/** `png` as KTX2, encoded as the export does for a colour (ETC1S, sRGB) or a normal map (UASTC, Zstandard, linear). */
function ktx2(tool: string, image: Uint8Array, normal: boolean): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'fixture-ktx-'));
  writeFileSync(join(dir, 'in.png'), image);
  const codec = normal ? ['--encode', 'uastc', '--zstd', '18', '--normalize'] : ['--encode', 'basis-lz', '--qlevel', '128'];
  const format = normal ? ['--format', 'R8G8B8_UNORM', '--assign-tf', 'linear'] : ['--format', 'R8G8B8_SRGB', '--assign-tf', 'srgb'];
  execFileSync(tool, ['create', ...format, '--generate-mipmap', ...codec, join(dir, 'in.png'), join(dir, 'out.ktx2')]);
  return new Uint8Array(readFileSync(join(dir, 'out.ktx2')));
}

export async function writeFixtures(): Promise<void> {
  const c = EXPECT.creature;
  let doc = new Document();
  const rig = {
    COLOR_0: { type: 'VEC4' as const, value: [0.6, 0.3, 0.1, 0.8] },
    _limb: { type: 'SCALAR' as const, value: [2] },
    _pivot: { type: 'VEC3' as const, value: c.pivot },
    _glow: { type: 'SCALAR' as const, value: [0.25] },
  };
  scene(doc, 'quad_grazer_0', box(doc, 'quad_grazer_0', c.min, c.max, rig), c.translation);
  await write(doc, 'creature.glb', { quantize: false });

  const f = EXPECT.flora;
  doc = new Document();
  scene(doc, 'bush_0', box(doc, 'bush_0', f.min, f.max, { COLOR_0: { type: 'VEC4', value: [0.2, 0.7, 0.1, 1] } }), f.translation);
  await write(doc, 'flora.glb', { quantize: false });

  const h = EXPECT.hull;
  doc = new Document();
  scene(doc, 'hull_0', box(doc, 'hull_0', h.min, h.max), h.translation);
  await write(doc, 'hull.glb', { quantize: true });

  doc = new Document();
  const mesh = box(doc, 'panel', [-0.5, 0, -0.5], [0.5, 1, 0.5]);
  const tool = await ensureKtx(ROOT);
  const colour = png(32, (x, y) => [((x >> 3) + (y >> 3)) % 2 ? 220 : 40, 120, 60]);
  const normal = png(32, (x) => [128 + Math.round(40 * Math.sin(x / 3)), 128, 240]);
  const texture = (name: string, bytes: Uint8Array) => doc.createTexture(name).setMimeType('image/ktx2').setImage(bytes);
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  mesh
    .listPrimitives()[0]!
    .getMaterial()!
    .setBaseColorTexture(texture('panel_baseColor', ktx2(tool, colour, false)))
    .setNormalTexture(texture('panel_normal', ktx2(tool, normal, true)));
  scene(doc, 'panel', mesh, [0, 0, 0]);
  await write(doc, 'textured.glb', { quantize: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await writeFixtures();
  console.log(`wrote the fixtures to ${FIXTURES}`);
}
