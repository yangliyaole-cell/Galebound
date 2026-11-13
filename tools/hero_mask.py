"""Thin rounded facial shell derived from the wearer's head, with fit auditing."""
from math import sqrt,exp,pi
from pathlib import Path
import json
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import tessellate_polygon
from hero_geometry import Surface,C,bezier
from hero_textures import mask_texture

def build_mask(finish,apply,recolor,arm,head,hy,profile,art,ivory,gold,leather):
    def profile_at(h):
        if h<0:
            a,b=profile[0],profile[1]
            return (a[1]*max(.025,(h+.014)/.014),a[2]+h*(b[2]-a[2])/(b[0]-a[0]),a[3]+h*(b[3]-a[3])/(b[0]-a[0]))
        h=max(profile[0][0],min(profile[-1][0],h))
        for i,(a,b) in enumerate(zip(profile,profile[1:])):
            if h<=b[0]:
                t=(h-a[0])/(b[0]-a[0]);span=b[0]-a[0]
                prev=profile[max(0,i-1)];nxt=profile[min(len(profile)-1,i+2)]
                return tuple((2*t**3-3*t*t+1)*a[j]+(t**3-2*t*t+t)*span*(b[j]-prev[j])/(b[0]-prev[0])+(-2*t**3+3*t*t)*b[j]+(t**3-t*t)*span*(nxt[j]-a[j])/(nxt[0]-a[0]) for j in (1,2,3))
        return profile[-1][1:]
    def width(h):
        w=profile_at(h)[0]*.994
        if h<.012:
            t=max(0,min(1,h/.012));t=t*t*(3-2*t)
            w*=.18+.82*t
        return w
    def bowl_z(x,h):
        w,front,back=profile_at(h)
        q=max(-.9999,min(.9999,x/max(.001,w)))
        # Broad ellipsoidal crown. No absolute-value ridge, central crease or
        # narrow nose spine: the first derivative at the center is zero.
        base=(front+back)/2+(front-back)/2*sqrt(max(.00001,1-q*q))
        return base+.014*exp(-((h-.113)/.05)**2-(x/.065)**2)+.003*exp(-((h-.054)/.028)**2-(x/.06)**2)
    def point(x,h):
        e=.000015
        dx=(bowl_z(x+e,h)-bowl_z(x-e,h))/(2*e)
        dy=(bowl_z(x,h+e)-bowl_z(x,h-e))/(2*e)
        # Fade the vertical offset at the free chin edge. Otherwise adjacent
        # rows can fold back over each other at the end of the skin surface.
        fade=max(0,min(1,h/.025));fade=fade*fade*(3-2*fade)
        normal=Vector((-dx,-dy*fade,1)).normalized()
        return Vector((x,hy+h,bowl_z(x,h)))+normal*(.0045+.0012*(1-fade))
    shell=Surface('Traveler_Mask');rows,cols=100,104
    samples=[]
    for k in range(rows+1):
        h=.0001+.2419*k/rows;w=width(h)
        for j in range(cols+1):
            x=w*(-1+2*j/cols);p=point(x,h)
            shell.vertex(p,ivory,'head')
            if .012<h<.226 and abs(x)<w*.95:samples.append((x,h,p.copy()))
    for k in range(rows):
        for j in range(cols):
            a=k*(cols+1)+j;shell.face((a,a+1,a+cols+2,a+cols+1))
    obj=finish(shell,.79)
    obj.modifiers.clear()
    apply(obj,'SOLIDIFY','1.8 mm ceramic shell',thickness=.0018,offset=-1,use_even_offset=True)
    eye=[]
    eye+=bezier((.012,.114,0),(.025,.150,0),(.061,.142,0),(.083,.181,0),28)
    eye+=bezier((.083,.181,0),(.070,.120,0),(.041,.143,0),(.012,.114,0),28)[1:-1]
    for side in (-1,1):
        vertices=[];faces=[];n=len(eye)
        for z in (-.12,.3):
            for x,h,_ in eye:vertices.append(C((side*x,hy+h,z)))
        for j in range(n):faces.append((j,(j+1)%n,(j+1)%n+n,j+n))
        faces.extend([tuple(reversed(range(n))),tuple(n+j for j in range(n))])
        mesh=bpy.data.meshes.new('Eye aperture tool');mesh.from_pydata(vertices,[],faces);mesh.update()
        cutter=bpy.data.objects.new('Eye aperture tool',mesh);bpy.context.collection.objects.link(cutter)
        bpy.context.view_layer.objects.active=cutter;cutter.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
        apply(obj,'BOOLEAN','Swept eye aperture',operation='DIFFERENCE',solver='EXACT',object=cutter)
        bpy.data.objects.remove(cutter,do_unlink=True)
    apply(obj,'BEVEL','Rounded ceramic perimeter',width=.00055,segments=3)
    for poly in obj.data.polygons:poly.use_smooth=True
    obj.vertex_groups.clear();vg=obj.vertex_groups.new(name='head');vg.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    modifier=obj.modifiers.new('Game skeleton','ARMATURE');modifier.object=arm
    # A decal image follows projected facial UVs without raised metal geometry.
    sigil=[(0,.238),(.0035,.219),(.01,.211),(.004,.205),(.004,.179),(.013,.171),(.0048,.166),(.0025,.145),(0,.132),(-.0025,.145),(-.0048,.166),(-.013,.171),(-.004,.179),(-.004,.205),(-.01,.211),(-.0035,.219)]
    mask_texture(art/'mask-albedo.png',sigil)
    image=bpy.data.images.load(str(art/'mask-albedo.png'),check_existing=True);image.pack()
    material=obj.data.materials[0]
    image_node=material.node_tree.nodes.new('ShaderNodeTexImage');image_node.image=image
    bsdf=material.node_tree.nodes.get('Principled BSDF')
    material.node_tree.links.new(image_node.outputs['Color'],bsdf.inputs['Base Color'])
    bsdf.inputs['Specular IOR Level'].default_value=.18
    recolor(obj,'#ffffff')
    obj['construction']='Ellipsoidal facial shell derived from the head; 1.8 mm wall, 4.5 mm nominal normal offset.'
    obj['mask_hy']=hy
    # Black backing sits inside the actual rounded apertures, close enough to
    # hide eyeballs while leaving an honest cut edge and wall thickness.
    liner=Surface('Traveler_Mask_Interior')
    for side in (-1,1):
        polygon=[Vector((side*x,h,0)) for x,h,_ in eye]
        for tri in tessellate_polygon([polygon]):
            a,b,c=[polygon[t] if isinstance(t,int) else t for t in tri];n=5;grid={}
            for i in range(n+1):
                for j in range(n+1-i):
                    q=a+(b-a)*i/n+(c-a)*j/n;p=point(q.x,q.y);p.z-=.0033
                    grid[i,j]=liner.vertex(p,'#121111','head')
            for i in range(n):
                for j in range(n-i):
                    liner.face((grid[i,j],grid[i+1,j],grid[i,j+1]))
                    if j<n-i-1:liner.face((grid[i+1,j],grid[i+1,j+1],grid[i,j+1]))
    finish(liner,1)
    band=Surface('Traveler_Mask_Strap')
    from math import sin,cos
    band.tube([(.100*sin(a),hy+.144,-.018+.122*cos(a)) for a in [pi*.40+(2*pi-pi*.80)*j/64 for j in range(65)]],.0038,leather,'head',10,flatten=.30)
    finish(band,.95)
    # Audit the *real subdivided skin*, not just the formula that generated it.
    bpy.context.view_layer.update()
    tree=BVHTree.FromObject(head,bpy.context.evaluated_depsgraph_get())
    distances=[];signed=[]
    for x,h,p in samples[::7]:
        nearest,normal,_,distance=tree.find_nearest(Vector(C(p)))
        distances.append(distance-.0018)
        signed.append((Vector(C(p))-nearest).dot(normal)-.0018)
    distances.sort()
    fit={'sample_count':len(distances),'inner_gap_min_mm':round(min(signed)*1000,3),'inner_gap_median_mm':round(distances[len(distances)//2]*1000,3),'inner_gap_p95_mm':round(distances[int(len(distances)*.95)]*1000,3),'inner_gap_max_mm':round(max(distances)*1000,3),'wall_mm':1.8,'ridge_term':False}
    (art/'mask-fit.json').write_text(json.dumps(fit,indent=2),encoding='utf-8')
    print('MASK_FIT '+json.dumps(fit))
    if min(signed)<-.0002:raise RuntimeError('Mask intersects the actual facial skin.')
    if distances[int(len(distances)*.95)]>.012:raise RuntimeError('Mask stands too far from the face.')
    return obj
