"""Render the real Blender asset, not a generated concept illustration."""
from pathlib import Path
import bpy
import sys
from mathutils import Vector
root=Path(__file__).resolve().parents[1]
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=20
scene.render.resolution_x=1000;scene.render.resolution_y=1200
scene.render.resolution_percentage=100
for obj in bpy.data.objects:
    if obj.type=='ARMATURE':obj.hide_render=True
for label,position,target,scale,mask in [
 ('blender-portrait',(2.6,1.7,5),(0,.96,0),2.13,True),
 ('blender-front',(0,.96,5),(0,.96,0),2.13,True),
 ('blender-left',(5,.96,0),(0,.96,0),2.13,True),
 ('blender-back',(0,.96,-5),(0,.96,0),2.13,True),
 ('blender-right',(-5,.96,0),(0,.96,0),2.13,True),
 ('blender-head',(.6,1.7,2.5),(0,1.65,0),.45,True),
 ('blender-mask-front',(0,1.69,2.5),(0,1.69,0),.37,True),
 ('blender-mask-side',(2.5,1.69,0),(0,1.69,0),.37,True),
 ('blender-unmasked',(.6,1.7,2.5),(0,1.65,0),.45,False),
 ('blender-profile',(2.5,1.67,0),(0,1.65,0),.45,False)]:
    if '--flight-only' in sys.argv:continue
    for obj in bpy.data.objects:
        if obj.name.startswith('Traveler_Mask'):obj.hide_render=not mask
    camera=scene.camera
    camera.location=(position[0],-position[2],position[1])
    look=Vector((target[0],-target[2],target[1]))
    camera.rotation_euler=(look-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=scale
    scene.render.filepath=str(root/'art/hero'/f'{label}.png')
    bpy.ops.render.render(write_still=True)

# Orthographic flight display uses the same semantic rotations as the game.
# Bone rest axes remain untouched; matrix conversion supplies world-space poses.
from math import pi
from mathutils import Matrix,Euler
import json
manifest=json.loads((root/'art/hero/manifest.json').read_text(encoding='utf-8'))
arm=bpy.data.objects['Traveler']
convert=Matrix.Rotation(pi/2,4,'X');game={};desired={};pivots={}
for name,joint in manifest['joints'].items():
    parent=joint['parent'];offset=Vector(joint['offset'])
    pivots[name]=offset+(pivots[parent] if parent else Vector())
    angle=pi/2 if name=='armL' else -pi/2 if name=='armR' else 0
    local=Matrix.Translation(offset)@Euler((0,0,angle)).to_matrix().to_4x4()
    game[name]=(game[parent] if parent else Matrix.Identity(4))@local
    bone=arm.pose.bones[name];bind=arm.data.bones[name].matrix_local
    desired[name]=convert@game[name]@Matrix.Translation(-pivots[name])@convert.inverted()@bind
    inherited=desired[parent]@arm.data.bones[parent].matrix_local.inverted()@bind if parent else bind
    bone.matrix_basis=inherited.inverted()@desired[name]
for obj in bpy.data.objects:
    if obj.name.startswith('Traveler_Mask'):obj.hide_render=False
    if obj.name.startswith('Traveler_Cape') and obj.data.shape_keys:obj.data.shape_keys.key_blocks['Glide'].value=1
bpy.context.view_layer.update()
for name in ('foreL','foreR','handL','handR'):
    expected=convert@game[name].translation
    assert (arm.pose.bones[name].head-expected).length<.001,(name,arm.pose.bones[name].head,expected)
camera=scene.camera;camera.location=(0,5,2.05)
target=Vector((0,0,1.05));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=2.65
scene.render.resolution_x=1500;scene.render.resolution_y=1000
scene.render.filepath=str(root/'art/hero/blender-flight.png');bpy.ops.render.render(write_still=True)
