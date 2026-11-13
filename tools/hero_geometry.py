from math import sin, cos, pi
import bpy
from mathutils import Vector

JOINTS = {}

def C(p):
    return (p[0], -p[2], p[1])

def linear(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4

def rgb(hex_value):
    h = hex_value.lstrip('#')
    return tuple(linear(int(h[i:i+2], 16) / 255) for i in (0, 2, 4)) + (1,)

class Surface:
    def __init__(self, name):
        self.name, self.vertices, self.faces, self.colors, self.weights = name, [], [], [], []

    def vertex(self, p, color, weight):
        self.vertices.append(C(p))
        self.colors.append(rgb(color))
        self.weights.append({weight: 1} if isinstance(weight, str) else weight)
        return len(self.vertices) - 1

    def face(self, indices):
        self.faces.append(tuple(indices))

    def loft(self, rings, color, weight, segments=32, caps=True, ripple=0):
        """rings: (height, x radius, z radius, x center, z center)."""
        base = len(self.vertices)
        for k, (y, rx, rz, x, z) in enumerate(rings):
            w = weight(y) if callable(weight) else weight
            for j in range(segments):
                a = 2 * pi * j / segments
                d = 1 + ripple * sin(a * 9 + k * .8)
                self.vertex((x + rx * cos(a) * d, y, z + rz * sin(a) * d), color, w)
        for k in range(len(rings) - 1):
            for j in range(segments):
                a = base + k * segments + j
                b = base + k * segments + (j + 1) % segments
                # rings run bottom to top; model coordinates are right-handed.
                self.face((a, a + segments, b + segments, b))
        if caps:
            for k, reverse in ((0, False), (len(rings)-1, True)):
                y, rx, rz, x, z = rings[k]
                mid = self.vertex((x, y, z), color, weight(y) if callable(weight) else weight)
                for j in range(segments):
                    a, b = base + k*segments+j, base+k*segments+(j+1)%segments
                    self.face((mid, b, a) if reverse else (mid, a, b))

    def ellipsoid(self, center, scale, color, weight, segments=24, rings=12):
        # Pole rings have tiny radii instead of duplicate vertices at the poles.
        data = []
        for k in range(rings + 1):
            a = -pi/2 + pi * (k + .001) / (rings + .002)
            data.append((center[1]+scale[1]*sin(a), scale[0]*cos(a), scale[2]*cos(a), center[0], center[2]))
        self.loft(data, color, weight, segments)

    def tube(self, points, radius, color, weight, segments=8, taper=None, flatten=1):
        points = [Vector(p) for p in points]
        base = len(self.vertices)
        for k, p in enumerate(points):
            t = k / (len(points)-1)
            direction = (points[min(k+1, len(points)-1)]-points[max(0, k-1)]).normalized()
            reference = Vector((0, 0, 1)) if abs(direction.z) < .9 else Vector((1, 0, 0))
            u = direction.cross(reference).normalized()
            v = direction.cross(u).normalized()
            r = radius * (taper(t) if taper else 1)
            w = weight(p.y) if callable(weight) else weight
            for j in range(segments):
                a = 2*pi*j/segments
                self.vertex(p+r*(u*cos(a)+v*sin(a)*flatten), color, w)
        for k in range(len(points)-1):
            for j in range(segments):
                a=base+k*segments+j
                b=base+k*segments+(j+1)%segments
                self.face((a,b,b+segments,a+segments))
        self.face(tuple(base+j for j in reversed(range(segments))))
        self.face(tuple(base+(len(points)-1)*segments+j for j in range(segments)))

    def ribbon(self, points, width, color, weight, depth=.003):
        # A broad strap following the surface, with modeled thickness.
        base=len(self.vertices)
        for k,p in enumerate(points):
            tangent=Vector(points[min(k+1,len(points)-1)])-Vector(points[max(0,k-1)])
            across=Vector((-tangent.y,tangent.x,0)).normalized()*width/2
            for dz in (-depth/2,depth/2):
                for side in (-1,1):
                    self.vertex(Vector(p)+across*side+Vector((0,0,dz)),color,weight(p[1]) if callable(weight) else weight)
        for k in range(len(points)-1):
            a=base+k*4
            for u,v in ((0,1),(1,3),(3,2),(2,0)):
                self.face((a+u,a+v,a+4+v,a+4+u))
        self.face((base+2,base+3,base+1,base))
        a=base+(len(points)-1)*4
        self.face((a,a+1,a+3,a+2))

    def finish(self, material, armature):
        mesh=bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.vertices,[],self.faces)
        mesh.update()
        obj=bpy.data.objects.new(self.name,mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(material)
        attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
        for i,col in enumerate(self.colors): attr.data[i].color=col
        for name in JOINTS:
            group=obj.vertex_groups.new(name=name)
            for i,weights in enumerate(self.weights):
                if name in weights and weights[name] > 0:
                    group.add([i],weights[name],'REPLACE')
        for p in mesh.polygons: p.use_smooth=True
        # Consistent outward normals, including the hand-created closed ribbons.
        bpy.context.view_layer.objects.active=obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        obj.select_set(False)
        mod=obj.modifiers.new('Game skeleton','ARMATURE')
        mod.object=armature
        obj.parent=armature
        obj['description']='Hand-authored procedural geometry; editable vertex colors and bone weights.'
        return obj

def material(name, roughness, metal=0):
    mat=bpy.data.materials.new(name)
    mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value=roughness
    bsdf.inputs['Metallic'].default_value=metal
    color=mat.node_tree.nodes.new('ShaderNodeVertexColor')
    color.layer_name='Color'
    mat.node_tree.links.new(color.outputs['Color'],bsdf.inputs['Base Color'])
    return mat

def interpolate(y, stops):
    if y <= stops[0][0]: return {stops[0][1]:1}
    for (a,na),(b,nb) in zip(stops,stops[1:]):
        if y <= b:
            if na==nb:return {na:1}
            t=(y-a)/(b-a)
            return {na:1-t,nb:t}
    return {stops[-1][1]:1}

def bezier(a,b,c,d,n=12):
    a,b,c,d=map(Vector,(a,b,c,d))
    return [tuple((1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d) for t in [i/(n-1) for i in range(n)]]

def band(surface,y,rx,rz,height,color,weight,x=0,z=0):
    surface.loft([(y-height/2,rx,rz,x,z),(y-height*.34,rx+.001,rz+.001,x,z),(y+height*.34,rx+.001,rz+.001,x,z),(y+height/2,rx,rz,x,z)],color,weight,caps=False)

def rounded_box(surface,center,size,color,weight,bevel=.006):
    # A beveled rectangular section loft, rather than a sharp primitive box.
    cx,cy,cz=center; sx,sy,sz=[v/2 for v in size]
    shape=[]
    for xx,zz,start in ((sx-bevel,sz-bevel,0),(-sx+bevel,sz-bevel,pi/2),(-sx+bevel,-sz+bevel,pi),(sx-bevel,-sz+bevel,3*pi/2)):
        for k in range(4):
            a=start+k*pi/6
            shape.append((xx+bevel*cos(a),zz+bevel*sin(a)))
    base=len(surface.vertices)
    for y,shrink in ((cy-sy,.91),(cy-sy+bevel,1),(cy+sy-bevel,1),(cy+sy,.91)):
        for x,z in shape:surface.vertex((cx+x*shrink,y,cz+z*shrink),color,weight)
    n=len(shape)
    for k in range(3):
        for j in range(n):
            a=base+k*n+j;b=base+k*n+(j+1)%n
            surface.face((a,a+n,b+n,b))
    surface.face(tuple(base+j for j in range(n-1,-1,-1)))
    surface.face(tuple(base+3*n+j for j in range(n)))

def export_game(target, objects, armature):
    """Export a derived game mesh; retain sculpt-resolution geometry in the source."""
    budgets={'Traveler_Jacket':17000,'Traveler_Hair':22000,'Traveler_Head':10000,
             'Traveler_Mask':50000,'Traveler_Scarf':5500,'Traveler_Trousers':6500,
             'Traveler_Arms':6500}
    originals={}
    try:
        for obj in objects:
            count=sum(len(f.vertices)-2 for f in obj.data.polygons)
            budget=budgets.get(obj.name,count)
            if count>budget and not obj.data.shape_keys:
                originals[obj]=obj.data
                obj.data=obj.data.copy()
                bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
                bpy.context.view_layer.objects.active=obj
                dec=obj.modifiers.new('Derived game topology','DECIMATE')
                dec.ratio=budget/count
                bpy.ops.object.modifier_move_up(modifier=dec.name)
                bpy.ops.object.modifier_apply(modifier=dec.name)
                for vertex in obj.data.vertices:
                    for entry in vertex.groups:
                        if entry.weight>1:obj.vertex_groups[entry.group].add([vertex.index],1,'REPLACE')
                obj.data.validate()
        count=sum(sum(len(f.vertices)-2 for f in obj.data.polygons) for obj in objects)
        bpy.ops.object.select_all(action='DESELECT');armature.select_set(True)
        for obj in objects:obj.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_skins=True,export_morph=True,export_extras=True,export_materials='EXPORT',export_vertex_color='ACTIVE',export_all_vertex_colors=False)
        return count
    finally:
        for obj,data in originals.items():
            temporary=obj.data;obj.data=data
            if not temporary.users:bpy.data.meshes.remove(temporary)
