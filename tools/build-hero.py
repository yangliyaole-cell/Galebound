"""Blender revision 4: reconstruction of the supplied masked-adventurer design.

blender --background --python tools/build-hero.py
Editing workflow: edit traveler.blend, then use export-hero.py (does not rebuild).
"""
from pathlib import Path
import sys, json, math
from math import sin, cos, pi, exp, sqrt
import bpy
from mathutils import Vector, Quaternion

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import hero_geometry as g
from hero_geometry import Surface, C, rgb, material, interpolate, bezier, band, rounded_box
ART=ROOT/'art/hero'; OUT=ROOT/'public/models'
ART.mkdir(parents=True,exist_ok=True); OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for group in (bpy.data.meshes,bpy.data.armatures,bpy.data.materials):
    for item in list(group):
        if not item.users:group.remove(item)

JOINTS={
 'body':(None,(0,1.0,0)), 'spine':('body',(0,.06,0)), 'chest':('spine',(0,.19,0)),
 'head':('chest',(0,.315,0)),
 'armL':('chest',(.185,.18,-.004)), 'foreL':('armL',(.017,-.28,.006)), 'handL':('foreL',(.012,-.265,.006)),
 'armR':('chest',(-.185,.18,-.004)), 'foreR':('armR',(-.017,-.28,.006)), 'handR':('foreR',(-.012,-.265,.006)),
 'legL':('body',(.085,-.03,0)), 'shinL':('legL',(0,-.47,.006)), 'footL':('shinL',(0,-.445,-.003)),
 'legR':('body',(-.085,-.03,0)), 'shinR':('legR',(0,-.47,.006)), 'footR':('shinR',(0,-.445,-.003)),
}
g.JOINTS=JOINTS
P={}
for n,(parent,offset) in JOINTS.items():P[n]=Vector(offset)+(P[parent] if parent else Vector())

def smooth(a,b,v):
    t=max(0,min(1,(v-a)/(b-a)))
    return t*t*(3-2*t)

def activate(obj):
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
    bpy.context.view_layer.objects.active=obj

def apply(obj,kind,name,**kw):
    activate(obj); mod=obj.modifiers.new(name,kind)
    for k,v in kw.items():setattr(mod,k,v)
    bpy.ops.object.modifier_apply(modifier=mod.name)

arm_data=bpy.data.armatures.new('Traveler anatomy')
arm=bpy.data.objects.new('Traveler',arm_data); bpy.context.collection.objects.link(arm)
activate(arm); bpy.ops.object.mode_set(mode='EDIT')
next_bone={'body':'spine','spine':'chest','chest':'head','armL':'foreL','foreL':'handL','armR':'foreR','foreR':'handR','legL':'shinL','shinL':'footL','legR':'shinR','shinR':'footR'}
for n,(parent,offset) in JOINTS.items():
    bone=arm_data.edit_bones.new(n); bone.head=C(P[n])
    tail=P[next_bone[n]] if n in next_bone else P[n]+Vector((0,.23,0) if n=='head' else (0,0,.14) if n.startswith('foot') else (0,-.10,.008))
    bone.tail=C(tail)
    if parent:bone.parent=arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT'); arm.select_set(False); arm.show_in_front=True
arm['revision']=4; arm['gameRig']=json.dumps(JOINTS)
arm['cloth']='One continuous cape with Glide, Flutter and Trail shape keys; legacy strips hidden in game.'

SKIN='#efcdb1'; SKIN_LIGHT='#f3d9c0'; SKIN_SHADE='#b58d77'
COAT='#352e2c'; COAT_LIGHT='#483c35'; COAT_DARK='#292524'
PANTS='#373130'; LEATHER='#5c4438'; LEATHER_LIGHT='#88654d'; DARK='#2c2827'
GOLD='#bc9a70'; HAIR='#372e2b'; HAIR_LIGHT='#4b3d35'
SCARF='#322c2b'; SCARF_DARK='#272323'; IVORY='#e8ddd1'; LINEN='#ded2c1'
torso=lambda y:interpolate(y,[(1.05,'body'),(1.15,'spine'),(1.34,'chest')])
objects=[]

def finish(data,rough=.75,metallic=0,subdiv=0):
    obj=data.finish(material(data.name,rough,metallic),arm)
    if subdiv:
        # Apply before the armature; the source retains editable smooth topology.
        skin=obj.modifiers.get('Game skeleton'); obj.modifiers.remove(skin)
        apply(obj,'SUBSURF','Sculpt surface',levels=subdiv,render_levels=subdiv)
        mod=obj.modifiers.new('Game skeleton','ARMATURE');mod.object=arm
    objects.append(obj);return obj

def recolor(obj,color):
    attr=obj.data.color_attributes.get('Color')
    if attr:obj.data.color_attributes.remove(attr)
    attr=obj.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
    for item in attr.data:item.color=rgb(color)

from hero_head import build_head
hy,eye_obj,head_obj,head_profile=build_head(globals())

# Shirt and dark fitted underlayer. The visible waist is higher than the former
# tunic, with four individually cut linen tails and gathered, bloused sleeves.
shirt=Surface('Traveler_Linen');under=Surface('Traveler_Underlayer')
shirt.loft([(1.065,.122,.091,0,0),(1.10,.121,.092,0,0),(1.17,.133,.10,0,-.002),
 (1.27,.15,.108,0,-.002),(1.35,.155,.108,0,-.003),(1.41,.127,.085,0,-.002),
 (1.47,.054,.049,0,-.005)],LINEN,torso,64,ripple=.014)
# Front linen overlays intentionally cover the black underlayer. This keeps the
# diagonal dark vest border visible at each side, as on the turnaround sheet.
def panel(data,points,color,weight,thickness=.002):
    base=len(data.vertices)
    for dz in (thickness/2,-thickness/2):
        for x,y,z in points:data.vertex((x,y,z+dz),color,weight(y) if callable(weight) else weight)
    n=len(points);data.face(tuple(base+i for i in range(n)));data.face(tuple(base+n+i for i in reversed(range(n))))
    for i in range(n):data.face((base+i,base+(i+1)%n,base+(i+1)%n+n,base+i+n))
# Vented ivory skirt panels: a split front and back, with irregular cut hems.
for front in (1,-1):
    for side in (-1,1):
        points=[(side*.012,1.10,front*.099),(side*.126,1.10,front*.084),
          (side*.165,.84+(side*.012),front*.109),(side*.042,.80,front*.127),
          (side*.022,.93,front*.117)]
        panel(shirt,points,LINEN if front==1 else '#c9bcab','body',.003)
        # Cloth creases are narrow shallow planes, rather than detached cords.
        panel(shirt,[(side*.055,1.075,front*.102),(side*.064,.90,front*.124),
                     (side*.082,.858,front*.125),(side*.068,1.075,front*.103)],'#c6b9a8','body',.001)
for side,suffix in ((1,'L'),(-1,'R')):
    armname='arm'+suffix;fore='fore'+suffix
    aw=lambda y,s=suffix:interpolate(y,[(1.11,'fore'+s),(1.18,'arm'+s)])
    under.loft([(1.15,.047,.046,side*.202,.004),(1.24,.057,.055,side*.197,0),
      (1.34,.06,.06,side*.188,-.003),(1.40,.052,.05,side*.183,-.004),
      (1.44,.022,.024,side*.169,-.006)],DARK,aw,48)
    shirt.loft([(1.025,.039,.038,side*.209,.008),(1.06,.05,.048,side*.207,.006),
      (1.12,.048,.047,side*.204,.004),(1.16,.047,.045,side*.202,.003)],LINEN,fore,48,ripple=.035)
    band(shirt,1.035,.043,.041,.025,'#bcb09f',fore,side*.209,.008)
finish(under,.92,subdiv=1);finish(shirt,.93)

# Chunky, dark, cross-folded high collar and short angular shoulder mantle.
# The top lip has real cloth thickness; it is not a stack of round tubes.
mantle=Surface('Traveler_Mantle')
from hero_cowl import build_cowl
cowl_obj,cowl_fold_obj=build_cowl(finish,apply,arm)

def wrap_mesh(data,nr,na,point,color,weight):
    start=len(data.vertices)
    for k in range(nr+1):
        v=k/nr
        for j in range(na):
            a=2*pi*j/na;data.vertex(point(a,v),color(a,v) if callable(color) else color,weight)
    for k in range(nr):
        for j in range(na):
            a=start+k*na+j;b=start+k*na+(j+1)%na;data.face((a,b,b+na,a+na))
    return start

def mantlepoint(a,v):
    # Slightly open at the front, with two broad lapels over the shoulder line.
    angle=.26+(2*pi-.52)*a/(2*pi)
    rx=.077+.205*sin(v*pi/2);rz=.064+.09*sin(v*pi/2)
    y=1.515-.225*v**1.5+.012*cos(angle*3+.5)*v
    y+=(.056*max(0,cos(angle))+.018*abs(sin(angle))+.012*sin(angle))*v**2
    return (rx*sin(angle),y,-.004+rz*cos(angle))
wrap_mesh(mantle,12,72,mantlepoint,lambda a,v:'#3c332f' if .3<a<2.5 else COAT,'chest')
mantle_obj=finish(mantle,.95)
mantle_obj.modifiers.clear();apply(mantle_obj,'SOLIDIFY','Layered shoulder cloth',thickness=.0035,offset=-1)
mod=mantle_obj.modifiers.new('Game skeleton','ARMATURE');mod.object=arm
# Folded-down rear hood: a soft angular V over the upper cloak, not a neck ball.
hood=Surface('Traveler_Hood')
panel(hood,[(-.12,1.50,-.092),(-.14,1.421,-.135),(0,1.348,-.167),(.14,1.421,-.135),(.12,1.50,-.092),(0,1.455,-.144)],'#2b2726','chest',.008)
finish(hood,.95)

# Thin planar anime hair and a facially fitted rounded ceramic shell.
from hero_hair import build_hair
hair_obj=build_hair(finish,hy,HAIR)
from hero_mask import build_mask
mask_obj=build_mask(finish,apply,recolor,arm,head_obj,hy,head_profile,ART,IVORY,GOLD,LEATHER)

# Belt, diagonally worn strap, left waist pouch and circular compass clasp.
leather=Surface('Traveler_Leather');brass=Surface('Traveler_Brass')
band(leather,1.087,.136,.103,.047,LEATHER,'body')
for yy in (1.068,1.105):band(leather,yy,.138,.105,.002,LEATHER_LIGHT,'body')
brass.tube([(-.021,1.064,.112),(.025,1.064,.112),(.025,1.111,.112),(-.021,1.111,.112),(-.021,1.064,.112)],.003,GOLD,'body',8)
brass.tube([(-.02,1.088,.116),(.013,1.088,.116)],.002,GOLD,'body',8)
for x in (-.076,.083):rounded_box(leather,(x,1.087,.088),(.014,.058,.014),DARK,'body',.003)
front=[(-.126,1.075,.081),(-.08,1.17,.107),(-.02,1.27,.125),(.046,1.38,.111),(.107,1.448,.073)]
for pts in (front,[(x,y,-z+.025) for x,y,z in front]):
    leather.ribbon(pts,.035,LEATHER,torso,.007)
    for side in (-1,1):leather.tube([(x+side*.013,y,z+(.004 if z>0 else -.004)) for x,y,z in pts],.0008,LEATHER_LIGHT,torso,6)
brass.tube([(.02,1.325,.13),(.045,1.309,.13),(.069,1.348,.122),(.045,1.365,.122),(.02,1.325,.13)],.0023,GOLD,'chest',8)
rounded_box(leather,(-.158,1.016,.065),(.111,.145,.078),LEATHER,'body',.013)
rounded_box(leather,(-.158,1.058,.072),(.12,.069,.084),'#684d3e','body',.012)
leather.ribbon([(-.158,1.072,.12),(-.158,.997,.117)],.016,LEATHER_LIGHT,'body',.004)
brass.tube([(-.168,1.008,.124),(-.148,1.008,.124),(-.148,1.035,.124),(-.168,1.035,.124),(-.168,1.008,.124)],.0023,GOLD,'body',8)
# Brooch rests on the character's right shoulder (left in the front view).
bx,by,bz=-.147,1.446,.117
pts=[(bx+.033*cos(a),by+.033*sin(a),bz) for a in [2*pi*j/64 for j in range(65)]]
brass.tube(pts,.003,GOLD,'chest',10)
for i in range(8):
    a=2*pi*i/8
    panel(brass,[(bx,by,bz+.001),(bx+.007*cos(a+pi/2),by+.007*sin(a+pi/2),bz+.001),
                 (bx+.027*cos(a),by+.027*sin(a),bz+.001),(bx-.005*cos(a+pi/2),by-.005*sin(a+pi/2),bz+.001)],GOLD,'chest',.002)
for off in (-.012,.008):
    panel(leather,[(bx+off-.007,by-.015,bz-.001),(bx+off+.007,by-.015,bz-.001),
                  (bx+off+.006,1.19,.137),(bx+off-.006,1.206,.137)],'#b29570','chest',.002)

# Dark gloves and forearms. The illustrated outfit has no broad brown bracers.
skin=Surface('Traveler_Arms');gloves=Surface('Traveler_Gloves')
for side,suffix in ((1,'L'),(-1,'R')):
    fore='fore'+suffix;hand='hand'+suffix;wx=side*.214
    skin.loft([(.882,.024,.026,wx,.009),(.94,.031,.033,side*.211,.008),(1.01,.038,.039,side*.207,.006),(1.07,.04,.04,side*.205,.005)],SKIN,fore,40)
    gloves.loft([(.91,.029,.032,side*.213,.008),(.96,.034,.035,side*.211,.008),(1.005,.038,.04,side*.208,.006)],DARK,fore,40,caps=False)
    band(gloves,.995,.04,.042,.018,'#403530',fore,side*.208,.006)
    skin.loft([(.825,.021,.029,wx,.009),(.847,.024,.032,wx,.009),(.884,.023,.028,wx,.009)],SKIN,hand,32)
    gloves.loft([(.833,.022,.03,wx,.009),(.859,.025,.034,wx,.009),(.891,.026,.029,wx,.009),(.906,.027,.029,wx,.009)],DARK,hand,32,caps=False)
    band(gloves,.895,.028,.03,.009,'#4b3c32',hand,wx,.009)
    for i,z in enumerate((-.014,.002,.018,.032)):
        length=(.04,.055,.058,.047)[i]
        pts=bezier((wx,.837,z),(wx+side*.002,.815,z),(wx+side*.01,.83-length,z+.005),(wx+side*.014,.827-length,z+.01),14)
        skin.tube(pts,.0067,SKIN,hand,12,taper=lambda t:1-.4*t)
        skin.ellipsoid(pts[-1],(.0042,.0045,.0042),SKIN,hand,12,8)
    pts=bezier((wx-side*.019,.865,.025),(wx-side*.03,.851,.034),(wx-side*.03,.837,.041),(wx-side*.023,.826,.043),14)
    skin.tube(pts,.008,SKIN,hand,12,taper=lambda t:1-.4*t)
finish(skin,.75);finish(gloves,.94)

# Full, gathered charcoal breeches, tan turn-down cuffs and low travel boots.
pants=Surface('Traveler_Trousers');boots=Surface('Traveler_Boots')
for side,suffix in ((1,'L'),(-1,'R')):
    x=side*.085;leg='leg'+suffix;shin='shin'+suffix;foot='foot'+suffix
    lw=lambda y,l=leg,s=shin:interpolate(y,[(.445,s),(.50,s),(.555,l)])
    pants.loft([(.397,.049,.053,x,.004),(.423,.064,.067,x,.004),(.47,.079,.078,x,.003),
      (.53,.079,.084,x,.003),(.64,.084,.086,x,-.003),(.77,.087,.089,x,-.006),
      (.90,.089,.091,x,-.004),(1.05,.075,.079,x,-.004),(1.08,.065,.068,x,-.002)],PANTS,lw,56)
    # Broad fabric fold planes close up at each gathered knee.
    for zsign in (-1,1):
        panel(pants,[(x-side*.054,.80,zsign*.064),(x-side*.013,.46,zsign*.076),
                     (x+side*.01,.43,zsign*.071),(x-side*.02,.79,zsign*.082)],'#2e2928',lw,.001)
    band(leather,.398,.056,.06,.042,'#a38a70',shin,x,.004)
    boots.loft([(.05,.043,.047,x,.003),(.10,.043,.049,x,.002),(.18,.04,.047,x,0),
      (.29,.043,.05,x,-.003),(.37,.048,.053,x,-.001),(.40,.05,.054,x,.002)],DARK,shin,48)
    band(leather,.198,.049,.054,.033,LEATHER,shin,x,.001)
    brass.tube([(x+side*.043,.182,.026),(x+side*.05,.182,.013),(x+side*.05,.212,.013),(x+side*.043,.212,.026),(x+side*.043,.182,.026)],.002,GOLD,shin,8)
    shape=[(-.062,.023,.025,.045),(-.041,.041,.038,.047),(-.006,.05,.049,.052),(.035,.054,.047,.049),(.09,.057,.034,.042),(.137,.054,.023,.034),(.17,.037,.017,.028),(.18,.013,.01,.024)]
    base=len(boots.vertices);n=40
    for z,rx,ry,cy in shape:
        for j in range(n):
            a=2*pi*j/n;boots.vertex((x+rx*cos(a),max(.013,cy+ry*sin(a)),z),DARK,foot)
    for k in range(len(shape)-1):
        for j in range(n):
            a=base+k*n+j;b=base+k*n+(j+1)%n;boots.face((a,b,b+n,a+n))
    boots.face(tuple(base+j for j in reversed(range(n))));boots.face(tuple(base+(len(shape)-1)*n+j for j in range(n)))
    outline=[(x+rx,.014,z) for z,rx,ry,cy in shape]+[(x-rx,.014,z) for z,rx,ry,cy in reversed(shape)];outline.append(outline[0])
    boots.tube(outline,.0065,'#25201f',foot,10)
    # The ankle and instep bands form the visible diagonal tan accents.
    leather.ribbon([(x-.034,.104,-.003),(x+.033,.071,.092)],.022,'#967656',foot,.004)
    rounded_box(boots,(x,.008,-.033),(.077,.016,.061),'#25201f',foot,.007)
finish(pants,.96,subdiv=1);finish(boots,.84);finish(leather,.88);finish(brass,.61,.25)

from hero_cloak import build_cloak
cape_objects=build_cloak(finish,('#3b3230','#473a34',GOLD),ART)

# Pack the supplied reference into the editable source for future revisions.
reference=bpy.data.collections.new('REFERENCE · supplied design');bpy.context.scene.collection.children.link(reference)
image=bpy.data.images.load(str(ART/'design-reference.png'),check_existing=True);image.pack()
reference_obj=bpy.data.objects.new('Masked adventurer design sheet',None)
reference.objects.link(reference_obj);reference_obj.empty_display_type='IMAGE';reference_obj.data=image
reference_obj.empty_display_size=3.5;reference_obj.location=(2.4,0,1);reference_obj.hide_render=True;reference.hide_viewport=True

scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.15,.14,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.35
for obj in objects:
    for v in obj.data.vertices:
        for entry in v.groups:
            if entry.weight>1:obj.vertex_groups[entry.group].add([v.index],1,'REPLACE')
    obj.data.validate()
    if not obj.get('keep_uv'):
        activate(obj);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.1519,island_margin=.007);bpy.ops.object.mode_set(mode='OBJECT')
    if obj==mask_obj:
        uv=obj.data.uv_layers.active
        for loop in obj.data.loops:
            co=obj.data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv=((co.x+.105)/.21,(co.z-hy)/.255)
    if obj.data.shape_keys:
        for key in obj.data.shape_keys.key_blocks:key.value=0
    obj.active_shape_key_index=0;obj['revision']=4
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            s=area.spaces.active;s.shading.type='MATERIAL';s.overlay.show_extras=False;s.overlay.show_floor=False
            s.region_3d.view_distance=3.5;s.region_3d.view_location=Vector((0,0,.95));s.region_3d.view_rotation=Quaternion((.89,.4,.08,.2)).normalized()
scene['asset']='Masked Adventurer / reference-sheet reconstruction / revision 4'
scene['reference']='Supplied character turnaround: art/hero/design-reference.png (packed)'
scene['editing']='Edit the source, export via tools/export-hero.py. Cape morphs preserve gold patterns.'
bpy.context.preferences.filepaths.save_version=0
studio=bpy.data.collections.new('STUDIO · not exported');scene.collection.children.link(studio)
def area(name,location,power,size,color):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
    obj=bpy.data.objects.new(name,data);studio.objects.link(obj);obj.location=C(location)
    obj.rotation_euler=(Vector(C((0,1.1,0)))-obj.location).to_track_quat('-Z','Y').to_euler()
area('Key',(-3,4,4),350,4,(1,.92,.84));area('Fill',(3,2,1.5),200,3,(.85,.9,1));area('Rim',(1.5,3,-3),380,3,(1,.94,.86))
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.014));floor=bpy.context.object;floor.name='Studio floor'
for collection in list(floor.users_collection):collection.objects.unlink(floor)
studio.objects.link(floor);floor_mat=bpy.data.materials.new('Warm backdrop');floor_mat.diffuse_color=(.55,.49,.44,1);floor.data.materials.append(floor_mat)
camera_data=bpy.data.cameras.new('Portrait lens');camera=bpy.data.objects.new('Portrait lens',camera_data);studio.objects.link(camera)
camera.location=C((2.5,1.7,4.7));camera.rotation_euler=(Vector(C((0,.96,0)))-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.type='ORTHO';camera_data.ortho_scale=2.16;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1100;scene.render.resolution_y=1250;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
activate(arm)
for obj in objects:obj.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'traveler.blend'))
source_triangles=sum(sum(len(f.vertices)-2 for f in obj.data.polygons) for obj in objects)
game_triangles=g.export_game(OUT/'traveler.glb',objects,arm)
stats={'name':'Masked Adventurer / reference reconstruction','revision':4,'height_m':round(max(v.co.z for obj in objects for v in obj.data.vertices),3),'triangles':game_triangles,'source_triangles':source_triangles,'meshes':len(objects),'bones':len(JOINTS),'materials':len(objects),'glb_bytes':(OUT/'traveler.glb').stat().st_size,'joints':{n:{'parent':p,'offset':o} for n,(p,o) in JOINTS.items()},'mask_objects':[o.name for o in objects if o.name.startswith('Traveler_Mask')],'cape_objects':[o.name for o in cape_objects],'reference':'design-reference.png'}
(ART/'manifest.json').write_text(json.dumps(stats,indent=2),encoding='utf-8')
print('HERO_ASSET '+json.dumps({k:v for k,v in stats.items() if k not in ('joints','mask_objects','cape_objects')}))
