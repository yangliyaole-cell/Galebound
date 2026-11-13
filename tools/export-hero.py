"""Export manual edits without rebuilding or overwriting traveler.blend.

blender --background art/hero/traveler.blend --python tools/export-hero.py
"""
from pathlib import Path
import json
import sys
import bpy
from mathutils import Matrix, Vector

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'tools'))
from hero_geometry import export_game
manifest=json.loads((root/'art/hero/manifest.json').read_text(encoding='utf-8'))
arm=bpy.data.objects.get('Traveler')
if arm is None or arm.type!='ARMATURE':
    raise RuntimeError('Expected an armature named Traveler.')
expected={}
for name,joint in manifest['joints'].items():
    expected[name]=Vector(joint['offset'])+(expected[joint['parent']] if joint['parent'] else Vector((0,0,0)))
    bone=arm.data.bones.get(name)
    if bone is None:raise RuntimeError(f'Missing game bone: {name}')
    world=arm.matrix_world@bone.head_local
    game=Vector((world.x,world.z,-world.y))
    if (game-expected[name]).length>.002:
        raise RuntimeError(f'Bind pivot changed: {name}. Keep game pivots, or update the runtime adapter intentionally.')
meshes=[obj for obj in bpy.data.objects if obj.type=='MESH' and any(m.type=='ARMATURE' and m.object==arm for m in obj.modifiers)]
if not meshes:raise RuntimeError('No meshes weighted to Traveler.')
if not any(obj.data.shape_keys and 'Blink' in obj.data.shape_keys.key_blocks for obj in meshes):
    raise RuntimeError('Keep the Blink shape key on the eye mesh.')
cape=[obj for obj in meshes if obj.name.startswith('Traveler_Cape')]
if len(cape)!=1:raise RuntimeError('Keep the single continuous cape mesh.')
if not cape[0].data.shape_keys or not all(name in cape[0].data.shape_keys.key_blocks for name in ('Glide','Flutter','Trail')):
    raise RuntimeError('Keep the Glide, Flutter and Trail cape shape keys.')
for obj in meshes:
    if not obj.data.color_attributes.get('Color'):
        raise RuntimeError(f'{obj.name}: retain the Color vertex-color layer used by game shading.')
    obj.data.color_attributes.active_color=obj.data.color_attributes['Color']
    if not obj.data.vertices:raise RuntimeError(f'{obj.name}: empty mesh.')
if bpy.context.object and bpy.context.object.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
for obj in meshes:obj.select_set(True)
stored={bone.name:bone.matrix_basis.copy() for bone in arm.pose.bones}
for bone in arm.pose.bones:bone.matrix_basis=Matrix.Identity(4)
for obj in meshes:
    if obj.data.shape_keys:
        for key in obj.data.shape_keys.key_blocks:key.value=0
bpy.context.view_layer.update()
target=root/'public/models/traveler.glb'
target.parent.mkdir(parents=True,exist_ok=True)
try:
    export_game(target,meshes,arm)
finally:
    for name,matrix in stored.items():arm.pose.bones[name].matrix_basis=matrix
print(f'Exported {target} ({target.stat().st_size:,} bytes). Source .blend was not overwritten.')
