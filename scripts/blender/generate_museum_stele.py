#!/usr/bin/env python3
"""Build the original BISUK virtual museum stele with Blender 2.93.

Run through Blender, not the system Python:

    blender --background --factory-startup \
      --python scripts/blender/generate_museum_stele.py -- \
      --output-glb apps/web/public/models/demo-a-museum-stele.glb \
      --output-blend assets/blender/demo-a-museum-stele.blend

The scene is deterministic: every shape is generated from fixed constants and a
fixed random seed.  It deliberately uses no downloaded model, image, texture,
font, or HDRI.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import random
import struct
import sys
from pathlib import Path
from typing import Iterable, Sequence, Tuple

import bpy
from mathutils import Vector


ASSET_ID = "asset-demo-a"
ASSET_VERSION = "1.1.0"
GENERATOR_SEED = 410219
BLENDER_MIN_VERSION = (2, 93, 0)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(
        description="Generate the deterministic BISUK DEMO-A museum stele."
    )
    parser.add_argument(
        "--output-glb",
        required=True,
        help="Destination for the compact web GLB.",
    )
    parser.add_argument(
        "--output-blend",
        required=True,
        help="Destination for the editable presentation .blend source.",
    )
    return parser.parse_args(argv)


def reset_scene() -> bpy.types.Scene:
    if bpy.app.version < BLENDER_MIN_VERSION:
        raise RuntimeError("Blender 2.93 or newer is required")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "BISUK_DEMO_A_MUSEUM_STELE"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.use_gtao = True
    scene.eevee.gtao_distance = 3.0
    scene.eevee.gtao_factor = 1.35
    scene.eevee.use_soft_shadows = True
    scene.render.resolution_x = 1080
    scene.render.resolution_y = 1350
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.camera = None

    # Color-management can be absent in a stripped portable build. The model
    # itself does not depend on these display settings.
    try:
        scene.view_settings.view_transform = "Filmic"
        scene.view_settings.look = "Medium High Contrast"
        scene.view_settings.exposure = 0.15
        scene.view_settings.gamma = 1.0
    except (TypeError, ValueError):
        pass

    scene["bisuk_asset_id"] = ASSET_ID
    scene["bisuk_asset_version"] = ASSET_VERSION
    scene["bisuk_generator_seed"] = GENERATOR_SEED
    scene["bisuk_source_state"] = "GENERATED_VISUAL_ONLY"
    scene["bisuk_measurement_allowed"] = False
    scene["bisuk_visualization_only"] = True
    scene["bisuk_units"] = "m"
    return scene


def new_collection(name: str) -> bpy.types.Collection:
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection


def move_to_collection(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def principled_material(
    name: str,
    base_color: Tuple[float, float, float, float],
    roughness: float,
    specular: float,
    noise_scale: float,
    noise_strength: float,
    color_variation: float,
) -> bpy.types.Material:
    """Create an embedded procedural PBR material.

    The .blend retains the procedural color and micro-normal network. The GLB
    still carries its Principled base color, roughness, and metallic response;
    no sidecar image files are required.
    """

    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = base_color
    material.roughness = roughness
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.name = "Material Output"
    output.location = (700, 0)
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.name = "Principled BSDF"
    shader.location = (430, 0)
    shader.inputs["Base Color"].default_value = base_color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Specular"].default_value = specular
    shader.inputs["Metallic"].default_value = 0.0

    tex_coord = nodes.new("ShaderNodeTexCoord")
    tex_coord.location = (-850, 0)
    mapping = nodes.new("ShaderNodeMapping")
    mapping.location = (-650, 0)
    noise = nodes.new("ShaderNodeTexNoise")
    noise.location = (-420, 90)
    noise.inputs["Scale"].default_value = noise_scale
    noise.inputs["Detail"].default_value = 5.0
    noise.inputs["Roughness"].default_value = 0.72
    color_ramp = nodes.new("ShaderNodeValToRGB")
    color_ramp.location = (-150, 150)
    darker = tuple(max(0.0, c - color_variation) for c in base_color[:3]) + (1.0,)
    lighter = tuple(min(1.0, c + color_variation * 0.55) for c in base_color[:3]) + (1.0,)
    color_ramp.color_ramp.elements[0].position = 0.24
    color_ramp.color_ramp.elements[0].color = darker
    color_ramp.color_ramp.elements[1].position = 0.78
    color_ramp.color_ramp.elements[1].color = lighter
    bump = nodes.new("ShaderNodeBump")
    bump.location = (170, -190)
    bump.inputs["Strength"].default_value = noise_strength
    bump.inputs["Distance"].default_value = 0.025

    links.new(tex_coord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], color_ramp.inputs["Fac"])
    links.new(color_ramp.outputs["Color"], shader.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    material["bisuk_procedural"] = True
    material["bisuk_external_dependencies"] = "none"
    return material


def create_rounded_box(
    name: str,
    dimensions: Sequence[float],
    location: Sequence[float],
    bevel_width: float,
    bevel_segments: int,
    subdivisions: int,
    material: bpy.types.Material,
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    obj.data.name = "{}_Mesh".format(name)
    obj.data.use_auto_smooth = True
    obj.data.auto_smooth_angle = math.radians(52.0)
    obj.data.materials.append(material)

    bevel = obj.modifiers.new("Hand-softened edges", "BEVEL")
    bevel.width = bevel_width
    bevel.segments = bevel_segments
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(22.5)
    bevel.harden_normals = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)

    if subdivisions:
        subdiv = obj.modifiers.new("Dense weathering topology", "SUBSURF")
        subdiv.subdivision_type = "SIMPLE"
        subdiv.levels = subdivisions
        subdiv.render_levels = subdivisions
        bpy.ops.object.modifier_apply(modifier=subdiv.name)
    return obj


def displace_stone_surface(
    obj: bpy.types.Object,
    amplitude: float,
    seed: int,
    arch_top: bool = False,
) -> None:
    """Apply stable, analytic multi-frequency weathering to mesh vertices."""

    rng = random.Random(seed)
    phases = [rng.uniform(-math.pi, math.pi) for _ in range(6)]
    mesh = obj.data
    mesh.calc_normals()
    height = max(v.co.z for v in mesh.vertices) - min(v.co.z for v in mesh.vertices)
    min_z = min(v.co.z for v in mesh.vertices)
    max_abs_x = max(abs(v.co.x) for v in mesh.vertices)

    for vertex in mesh.vertices:
        co = vertex.co.copy()
        normal = vertex.normal.normalized()
        low = (
            math.sin(co.x * 8.7 + co.z * 5.3 + phases[0])
            + 0.58 * math.sin(co.x * 19.1 - co.z * 12.7 + phases[1])
            + 0.31 * math.cos(co.y * 31.0 + co.z * 24.4 + phases[2])
        ) / 1.89
        grain = (
            math.sin(co.x * 47.0 + co.z * 38.0 + phases[3])
            * math.cos(co.y * 59.0 - co.z * 29.0 + phases[4])
        )
        edge_bias = 0.78 + 0.44 * max(abs(normal.x), abs(normal.z))
        vertex.co += normal * amplitude * edge_bias * (0.78 * low + 0.22 * grain)

        if arch_top and normal.z > 0.45:
            x_norm = min(1.0, abs(co.x) / max_abs_x)
            vertex.co.z += 0.075 * (1.0 - x_norm * x_norm)

        if arch_top:
            z_norm = max(0.0, min(1.0, (co.z - min_z) / height))
            taper = 1.0 - 0.055 * max(0.0, (z_norm - 0.56) / 0.44)
            vertex.co.x *= taper

    mesh.update(calc_edges=True)


def shade_stone(obj: bpy.types.Object) -> None:
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.data.use_auto_smooth = True
    obj.data.auto_smooth_angle = math.radians(52.0)


def create_edge_chips(
    slab: bpy.types.Object,
    collection: bpy.types.Collection,
) -> int:
    """Cut a stable set of small losses from the slab silhouette."""

    rng = random.Random(GENERATOR_SEED + 73)
    cutters = []
    chip_specs = [
        (-0.515, -0.105, 0.72),
        (0.512, -0.045, 0.94),
        (-0.514, 0.015, 1.28),
        (0.513, -0.08, 1.66),
        (-0.507, 0.035, 2.08),
        (0.505, -0.08, 2.47),
        (-0.37, -0.03, 2.78),
        (0.23, -0.10, 2.84),
        (0.43, 0.055, 2.70),
    ]
    for index, (x, y, z) in enumerate(chip_specs):
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=2,
            radius=1.0,
            location=(x, y, z),
        )
        cutter = bpy.context.object
        cutter.name = "WeatheringChip_{:02d}".format(index + 1)
        cutter.scale = (
            rng.uniform(0.045, 0.095),
            rng.uniform(0.045, 0.11),
            rng.uniform(0.045, 0.12),
        )
        cutter.rotation_euler = (
            rng.uniform(-1.0, 1.0),
            rng.uniform(-1.0, 1.0),
            rng.uniform(-1.0, 1.0),
        )
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        move_to_collection(cutter, collection)
        cutters.append(cutter)

    bpy.ops.object.select_all(action="DESELECT")
    for cutter in cutters:
        cutter.select_set(True)
    bpy.context.view_layer.objects.active = cutters[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = "WeatheringChip_Cutters"

    bpy.context.view_layer.objects.active = slab
    slab.select_set(True)
    joined.select_set(False)
    modifier = slab.modifiers.new("Missing edge fragments", "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.object = joined
    if hasattr(modifier, "solver"):
        modifier.solver = "EXACT"
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(joined, do_unlink=True)
    return len(chip_specs)


# Abstract, fictional marks designed for this project. Coordinates are local to
# a 1 x 1 glyph cell and intentionally do not transcribe a historical object.
GLYPH_PATTERNS = (
    (((-0.34, 0.28), (0.30, 0.28)), ((-0.20, 0.05), (0.22, 0.05)), ((0.0, 0.36), (-0.02, -0.34)), ((-0.32, -0.28), (0.30, -0.28))),
    (((-0.30, 0.32), (0.28, 0.32)), ((-0.26, 0.32), (-0.26, -0.32)), ((0.28, 0.32), (0.28, -0.32)), ((-0.26, -0.32), (0.28, -0.32)), ((-0.26, 0.03), (0.15, 0.03))),
    (((-0.34, 0.10), (0.34, 0.10)), ((0.0, 0.36), (-0.24, -0.34)), ((0.0, 0.20), (0.27, -0.34))),
    (((-0.30, 0.30), (0.30, 0.30)), ((-0.30, 0.02), (0.18, 0.02)), ((-0.28, -0.30), (0.30, -0.30)), ((0.10, 0.30), (-0.02, -0.30))),
    (((-0.30, 0.34), (-0.04, 0.02), (0.30, 0.32)), ((-0.32, -0.30), (0.0, 0.02), (0.32, -0.30)), ((-0.20, -0.10), (0.20, -0.10))),
    (((-0.32, 0.30), (0.32, 0.30)), ((-0.25, 0.30), (-0.10, -0.32)), ((0.20, 0.28), (0.20, -0.30)), ((-0.15, -0.08), (0.20, -0.08))),
    (((-0.34, 0.26), (0.04, 0.34), (0.32, 0.12)), ((-0.30, -0.06), (0.05, 0.05), (0.30, -0.14)), ((-0.22, -0.30), (0.24, -0.30))),
)


def create_glyph_curve(
    name: str,
    y: float,
    bevel_depth: float,
    collection: bpy.types.Collection,
    material: bpy.types.Material | None = None,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.resolution_v = 0
    curve.bevel_depth = bevel_depth
    curve.bevel_resolution = 2
    curve.resolution_u = 1
    curve.fill_mode = "FULL"

    columns = (-0.31, 0.0, 0.31)
    rows = (2.47, 2.11, 1.75, 1.39, 1.03, 0.67)
    cell_width = 0.31
    cell_height = 0.31
    glyph_index = 0
    for row_index, row_z in enumerate(rows):
        for column_index, column_x in enumerate(columns):
            pattern = GLYPH_PATTERNS[(glyph_index * 3 + row_index + column_index) % len(GLYPH_PATTERNS)]
            jitter_rng = random.Random(GENERATOR_SEED + glyph_index * 101)
            for stroke_index, stroke in enumerate(pattern):
                spline = curve.splines.new("POLY")
                spline.points.add(len(stroke) - 1)
                for point, (px, pz) in zip(spline.points, stroke):
                    jitter_x = jitter_rng.uniform(-0.008, 0.008)
                    jitter_z = jitter_rng.uniform(-0.008, 0.008)
                    point.co = (
                        column_x + px * cell_width + jitter_x,
                        y,
                        row_z + pz * cell_height + jitter_z,
                        1.0,
                    )
                spline.use_cyclic_u = False
            glyph_index += 1

    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    if material:
        obj.data.materials.append(material)
    return obj


def curve_to_mesh(obj: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    return bpy.context.object


def carve_glyphs(
    slab: bpy.types.Object,
    collection: bpy.types.Collection,
    cavity_material: bpy.types.Material,
) -> bpy.types.Object:
    cutter = create_glyph_curve(
        "FictionalGlyph_GrooveCutter",
        y=-0.153,
        bevel_depth=0.022,
        collection=collection,
    )
    cutter = curve_to_mesh(cutter)
    modifier = slab.modifiers.new("Hand-carved fictional inscription", "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.object = cutter
    if hasattr(modifier, "solver"):
        modifier.solver = "EXACT"
    bpy.context.view_layer.objects.active = slab
    slab.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

    # A narrow mesh sits below the untouched face, acting as physically located
    # cavity darkness instead of a flat decal. It is part of the web GLB.
    cavity = create_glyph_curve(
        "GlyphCavity_Shadow",
        y=-0.141,
        bevel_depth=0.0105,
        collection=collection,
        material=cavity_material,
    )
    cavity = curve_to_mesh(cavity)
    cavity["bisuk_role"] = "glyph_cavity"
    cavity["historical_transcription"] = False
    return cavity


def set_asset_metadata(obj: bpy.types.Object, role: str) -> None:
    obj["bisuk_asset_id"] = ASSET_ID
    obj["bisuk_asset_version"] = ASSET_VERSION
    obj["bisuk_role"] = role
    obj["source_state"] = "GENERATED_VISUAL_ONLY"
    obj["measurement_allowed"] = False
    obj["visualization_only"] = True
    obj["unit"] = "m"


def create_asset(asset_collection: bpy.types.Collection) -> list[bpy.types.Object]:
    weathered_stone = principled_material(
        "PBR_Weathered_Granite",
        (0.255, 0.238, 0.205, 1.0),
        roughness=0.82,
        specular=0.32,
        noise_scale=6.8,
        noise_strength=0.34,
        color_variation=0.085,
    )
    plinth_stone = principled_material(
        "PBR_Museum_Plinth_Stone",
        (0.155, 0.145, 0.125, 1.0),
        roughness=0.74,
        specular=0.31,
        noise_scale=8.5,
        noise_strength=0.21,
        color_variation=0.045,
    )
    cavity_material = principled_material(
        "PBR_Carved_Cavity",
        (0.050, 0.043, 0.034, 1.0),
        roughness=0.93,
        specular=0.18,
        noise_scale=13.0,
        noise_strength=0.08,
        color_variation=0.018,
    )

    lower = create_rounded_box(
        "Plinth_Lower",
        (1.38, 0.72, 0.15),
        (0.0, 0.0, 0.075),
        0.035,
        3,
        1,
        plinth_stone,
        asset_collection,
    )
    middle = create_rounded_box(
        "Plinth_Middle",
        (1.16, 0.59, 0.16),
        (0.0, 0.0, 0.225),
        0.028,
        3,
        1,
        plinth_stone,
        asset_collection,
    )
    upper = create_rounded_box(
        "Plinth_Upper",
        (0.96, 0.48, 0.13),
        (0.0, 0.0, 0.365),
        0.022,
        3,
        1,
        weathered_stone,
        asset_collection,
    )
    for index, pedestal_piece in enumerate((lower, middle, upper)):
        displace_stone_surface(
            pedestal_piece,
            amplitude=(0.0045, 0.0040, 0.0035)[index],
            seed=GENERATOR_SEED + 10 + index,
        )
        shade_stone(pedestal_piece)
        set_asset_metadata(pedestal_piece, "plinth")

    slab = create_rounded_box(
        "Stele_Weathered_HighRes",
        (1.04, 0.30, 2.36),
        (0.0, 0.0, 1.59),
        0.058,
        5,
        3,
        weathered_stone,
        asset_collection,
    )
    displace_stone_surface(
        slab,
        amplitude=0.0125,
        seed=GENERATOR_SEED,
        arch_top=True,
    )
    chip_count = create_edge_chips(slab, asset_collection)
    cavity = carve_glyphs(slab, asset_collection, cavity_material)
    shade_stone(slab)
    shade_stone(cavity)
    set_asset_metadata(slab, "weathered_stele")
    set_asset_metadata(cavity, "glyph_cavity")
    slab["weathering_chip_count"] = chip_count
    slab["fictional_glyph_count"] = 18
    slab["external_model_count"] = 0
    slab["external_texture_count"] = 0

    asset_objects = [lower, middle, upper, slab, cavity]
    for obj in asset_objects:
        obj.hide_render = False
    return asset_objects


def look_at(obj: bpy.types.Object, target: Iterable[float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def create_area_light(
    name: str,
    location: Sequence[float],
    energy: float,
    size: float,
    color: Sequence[float],
    target: Sequence[float],
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    light_data = bpy.data.lights.new(name, "AREA")
    light_data.energy = energy
    light_data.size = size
    light_data.color = color
    light = bpy.data.objects.new(name, light_data)
    collection.objects.link(light)
    light.location = location
    look_at(light, target)
    return light


def create_studio(studio_collection: bpy.types.Collection) -> None:
    floor_material = principled_material(
        "Studio_Floor",
        (0.026, 0.024, 0.022, 1.0),
        roughness=0.67,
        specular=0.28,
        noise_scale=2.2,
        noise_strength=0.05,
        color_variation=0.01,
    )
    bpy.ops.mesh.primitive_plane_add(size=14.0, location=(0.0, 0.0, -0.004))
    floor = bpy.context.object
    floor.name = "Museum_Floor_NotExported"
    floor.data.materials.append(floor_material)
    move_to_collection(floor, studio_collection)

    camera_data = bpy.data.cameras.new("Museum_Hero_Camera")
    camera_data.lens = 58.0
    camera_data.sensor_width = 36.0
    camera_data.dof.use_dof = True
    camera_data.dof.focus_distance = 6.2
    camera_data.dof.aperture_fstop = 8.0
    camera = bpy.data.objects.new("Museum_Hero_Camera", camera_data)
    studio_collection.objects.link(camera)
    camera.location = (3.25, -5.85, 2.72)
    look_at(camera, (0.0, 0.0, 1.43))
    bpy.context.scene.camera = camera

    target = (0.0, 0.0, 1.46)
    create_area_light(
        "Key_Raking_Warm",
        (-3.4, -3.8, 4.4),
        1050.0,
        2.25,
        (1.0, 0.73, 0.48),
        target,
        studio_collection,
    )
    create_area_light(
        "Fill_Cool_Soft",
        (3.0, -2.4, 3.0),
        510.0,
        3.4,
        (0.55, 0.67, 1.0),
        target,
        studio_collection,
    )
    create_area_light(
        "Rim_Top",
        (0.7, 2.1, 4.8),
        920.0,
        1.5,
        (1.0, 0.86, 0.66),
        (0.0, 0.0, 1.9),
        studio_collection,
    )

    world = bpy.data.worlds.new("Museum_World")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.008, 0.010, 0.014, 1.0)
    background.inputs["Strength"].default_value = 0.16


def validate_glb(path: Path) -> dict[str, object]:
    size = path.stat().st_size
    if size < 16_000:
        raise RuntimeError("GLB unexpectedly small: {} bytes".format(size))
    with path.open("rb") as handle:
        header = handle.read(12)
    magic, version, declared_size = struct.unpack("<4sII", header)
    if magic != b"glTF":
        raise RuntimeError("Invalid GLB magic: {!r}".format(magic))
    if version != 2:
        raise RuntimeError("Expected glTF 2, received {}".format(version))
    if declared_size != size:
        raise RuntimeError(
            "GLB length mismatch: header={}, file={}".format(declared_size, size)
        )
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"bytes": size, "sha256": digest, "version": version}


def export_asset(asset_objects: Sequence[bpy.types.Object], output_glb: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in asset_objects:
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = asset_objects[0]

    # Blender 2.93's glTF exporter cannot translate procedural Noise/ColorRamp
    # chains. Temporarily expose the Principled fallback values so the GLB gets
    # correct base-color factors, then restore the full .blend material graph.
    detached_links = []
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        shader = material.node_tree.nodes.get("Principled BSDF")
        if shader is None:
            continue
        for socket_name in ("Base Color", "Normal"):
            socket = shader.inputs.get(socket_name)
            if socket is None:
                continue
            for link in list(socket.links):
                detached_links.append(
                    (material.node_tree, link.from_socket, link.to_socket)
                )
                material.node_tree.links.remove(link)

    try:
        bpy.ops.export_scene.gltf(
            filepath=str(output_glb),
            export_format="GLB",
            use_selection=True,
            export_cameras=False,
            export_lights=False,
            export_materials="EXPORT",
            export_colors=True,
            export_normals=True,
            export_texcoords=False,
            export_tangents=False,
            export_animations=False,
            export_apply=True,
            export_extras=True,
            export_yup=True,
            export_draco_mesh_compression_enable=False,
        )
    finally:
        for node_tree, from_socket, to_socket in detached_links:
            node_tree.links.new(from_socket, to_socket)


def main() -> None:
    args = parse_args()
    output_glb = Path(args.output_glb).expanduser().resolve()
    output_blend = Path(args.output_blend).expanduser().resolve()
    output_glb.parent.mkdir(parents=True, exist_ok=True)
    output_blend.parent.mkdir(parents=True, exist_ok=True)

    random.seed(GENERATOR_SEED)
    reset_scene()
    asset_collection = new_collection("BISUK_WEB_ASSET")
    studio_collection = new_collection("BISUK_PRESENTATION_STUDIO")
    asset_objects = create_asset(asset_collection)
    create_studio(studio_collection)

    export_asset(asset_objects, output_glb)
    metadata = validate_glb(output_glb)

    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend), compress=True)
    if output_blend.stat().st_size < 50_000:
        raise RuntimeError("Blend source unexpectedly small")

    triangles = 0
    vertices = 0
    for obj in asset_objects:
        if obj.type != "MESH":
            continue
        vertices += len(obj.data.vertices)
        triangles += sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)
    print(
        "BISUK_ASSET_OK id={} vertices={} triangles={} glb_bytes={} glb_sha256={} blend_bytes={}".format(
            ASSET_ID,
            vertices,
            triangles,
            metadata["bytes"],
            metadata["sha256"],
            output_blend.stat().st_size,
        )
    )


if __name__ == "__main__":
    main()
