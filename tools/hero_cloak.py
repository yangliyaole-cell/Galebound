"""A single continuous cloak pattern which unfolds along its front edges."""
from math import sin,cos,pi,exp
import json
from mathutils import Vector
import bpy
from hero_geometry import Surface,C
from hero_textures import cloak_texture

def hermite(t,knots):
    index=min(len(knots)-2,max(0,next((i for i in range(len(knots)-1) if t<=knots[i+1][0]),len(knots)-2)))
    ta,a=knots[index];tb,b=knots[index+1];a,b=Vector(a),Vector(b)
    prev=knots[max(0,index-1)];nxt=knots[min(len(knots)-1,index+2)]
    ma=(b-Vector(prev[1]))/(tb-prev[0]);mb=(Vector(nxt[1])-a)/(nxt[0]-ta)
    u=(t-ta)/(tb-ta);span=tb-ta
    return (2*u**3-3*u*u+1)*a+(u**3-2*u*u+u)*span*ma+(-2*u**3+3*u*u)*b+(u**3-u*u)*span*mb

def build_cloak(finish,colors,art):
    # A material boundary runs from the neck, over the shoulder, then down the
    # open front to its calf-length point. In flight that SAME boundary follows
    # the outstretched arm. It is not a short neckline stretched into a wing.
    folded_lead=[(0,(0,1.488,-.117)),(.25,(.267,1.434,-.035)),(.5,(.313,1.13,.059)),(.75,(.389,.765,.072)),(1,(.465,.405,.048))]
    folded_hem=[(0,(0,.696,-.21)),(.035,(.031,.643,-.21)),(.25,(.223,.632,-.19)),(.5,(.390,.535,-.081)),(.75,(.472,.441,.012)),(1,(.465,.405,.048))]
    flight_lead=[(0,(0,1.488,-.117)),(.18,(.196,1.435,-.09)),(.44,(.480,1.429,-.064)),(.68,(.741,1.47,-.047)),(1,(1.09,1.59,-.035))]
    flight_hem=[(0,(0,1.055,-.15)),(.23,(.251,1.125,-.12)),(.48,(.523,.978,-.10)),(.72,(.785,1.26,-.064)),(1,(1.09,1.59,-.035))]
    def point(u,v,glide=0):
        side=1 if u>=0 else -1;s=abs(u)
        fa=hermite(s,folded_lead);fb=hermite(s,folded_hem)
        aa=hermite(s,flight_lead);ab=hermite(s,flight_hem)
        folded=fa*(1-v)+fb*v
        folded.z+=.008*cos(u*pi*10)*sin(pi*v)*(1-s*.45)
        flown=aa*(1-v)+ab*v
        flown.y+=.055*sin(2*pi*v)*exp(-(s/.27)**4)
        flown.z-=.018*sin(pi*v)*sin(pi*s)
        p=folded*(1-glide)+flown*glide;p.x*=side
        return p
    def normal(u,v,glide):
        e=.0001
        du=point(min(.9999,u+e),v,glide)-point(max(-.9999,u-e),v,glide)
        dv=point(u,min(1,v+e),glide)-point(u,max(0,v-e),glide)
        n=du.cross(dv).normalized()
        return n if n.length>.1 else Vector((0,0,1))
    data=Surface('Traveler_Cape');metadata=[];nu,nv=88,48
    for layer in (0,1):
        offset=.0007 if layer==0 else -.0007
        for j in range(nv+1):
            v=j/nv
            for i in range(nu+1):
                u=-.999+1.998*i/nu
                p=point(u,v)+normal(u,v,0)*offset
                data.vertex(p,'#ffffff','chest');metadata.append((u,v,offset))
    count=(nu+1)*(nv+1)
    for layer in (0,1):
        for j in range(nv):
            for i in range(nu):
                a=layer*count+j*(nu+1)+i;f=(a,a+1,a+nu+2,a+nu+1)
                data.face(f if layer==0 else tuple(reversed(f)))
    boundary=list(range(nu+1))+[j*(nu+1)+nu for j in range(1,nv+1)]+[nv*(nu+1)+i for i in range(nu-1,-1,-1)]+[j*(nu+1) for j in range(nv-1,0,-1)]
    for a,b in zip(boundary,boundary[1:]+boundary[:1]):data.face((a,b,b+count,a+count))
    obj=finish(data,.98)
    obj.shape_key_add(name='Basis')
    for name in ('Glide','Flutter','Trail'):
        key=obj.shape_key_add(name=name);key.value=0
        for i,(u,v,offset) in enumerate(metadata):
            glide=1 if name=='Glide' else 0
            p=point(u,v,glide)+normal(u,v,glide)*offset
            if name=='Flutter':
                # Collar and shoulder remain pinned; flutter is strongest at
                # the hems and front tips, not at the hand attachment edge.
                factor=(v*.7+abs(u)*.3)**2
                p.z+=sin(u*11+v*7)*.018*factor
                p.x+=sin(u*8-v*6)*.007*factor
            if name=='Trail':
                p.z-=.17*v*v;p.y+=.045*v*v
            key.data[i].co=C(p)
    obj.active_shape_key_index=0
    uv=obj.data.uv_layers.new(name='Garment pattern')
    for loop in obj.data.loops:
        u,v,_=metadata[loop.vertex_index];uv.data[loop.index].uv=((u+1)/2,1-v)
    obj['keep_uv']=True
    # Project side emblems onto the hanging panel in physical metres, then
    # retain that material placement through the unfolding deformation.
    grid=[(u,v,point(u,v)) for u in [.35+i*.035 for i in range(19)] for v in [.01+i*.055 for i in range(19)]]
    def inverse_xy(x,y,seed=None):
        nearest=sorted(grid,key=lambda q:(q[2].x-x)**2+(q[2].y-y)**2)[:3]
        starts=([seed] if seed else [])+[(q[0],q[1]) for q in nearest]
        answers=[]
        for u,v in starts:
            for _ in range(35):
                p=point(u,v);e=.0001
                pu=(point(u+e,v)-point(u-e,v))/(2*e);pv=(point(u,v+e)-point(u,v-e))/(2*e)
                ex,ey=x-p.x,y-p.y;det=pu.x*pv.y-pu.y*pv.x
                if abs(det)<1e-9:break
                du=(ex*pv.y-ey*pv.x)/det;dv=(pu.x*ey-pu.y*ex)/det
                rate=1
                old=ex*ex+ey*ey
                for _ in range(12):
                    uu=max(.35,min(.995,u+du*rate));vv=max(.005,min(.995,v+dv*rate));pnew=point(uu,vv)
                    if (pnew.x-x)**2+(pnew.y-y)**2<=old+1e-12:break
                    rate*=.5
                u,v=uu,vv
                if old<1e-12:break
            p=point(u,v);error=(p.x-x)**2+(p.y-y)**2
            regularizer=((u-seed[0])**2+(v-seed[1])**2)*1e-7 if seed else 0
            answers.append((error+regularizer,u,v))
        _,u,v=min(answers)
        return u,v
    paths=[]
    def add(points,width=.004):paths.append((points,width))
    def star_uv(cx,cy,rx,ry):
        return [(cx,cy-ry),(cx+rx*.25,cy-ry*.2),(cx+rx,cy),(cx+rx*.25,cy+ry*.2),(cx,cy+ry),(cx-rx*.25,cy+ry*.2),(cx-rx,cy),(cx-rx*.25,cy-ry*.2),(cx,cy-ry)]
    # Rear insignia: wide four-point compass diamond and long vertical spear.
    add(star_uv(0,.52,.115,.155),.0043)
    add([(-.095,.52),(.095,.52)],.0024);add([(0,.10),(0,.89)],.0032)
    add([(-.016,.18),(0,.10),(.016,.18)],.0035)
    add([(-.011,.76),(0,.89),(.011,.76)],.0035)
    # Folded side panel emblems have the same proportions as the design sheet.
    center=Vector((.39,.615));vertical=Vector((-.029,.09));horizontal=Vector((.026,.0078))
    glyph=[center+vertical,center+vertical*.22+horizontal*.25,center+horizontal,
           center-vertical*.22+horizontal*.25,center-vertical,
           center-vertical*.22-horizontal*.25,center-horizontal,
           center+vertical*.22-horizontal*.25,center+vertical]
    glyph_errors=[]
    def map_path(path):
        dense=[]
        for a,b in zip(path,path[1:]):
            a,b=Vector(a),Vector(b);steps=max(2,int((b-a).length/.0025))
            dense.extend([a+(b-a)*i/steps for i in range(steps)])
        dense.append(Vector(path[-1]))
        mapped=[];seed=None
        for q in dense:
            seed=inverse_xy(q.x,q.y,seed);mapped.append(seed)
            p=point(*seed);glyph_errors.append(((p.x-q.x)**2+(p.y-q.y)**2)**.5)
        return mapped
    mapped=map_path(glyph)
    for side in (-1,1):
        add([(u*side,v) for u,v in mapped],.005)
        for a,b in [(center-horizontal*.75,center+horizontal*.75),(center-vertical*.8,center+vertical*.8)]:
            add([(u*side,v) for u,v in map_path([a,b])],.0027)
        add([(side*u,.024) for u in (.265,.40,.58,.76,.95,.987)],.0045)
        add([(side*u,.975) for u in (.65,.76,.88,.97)],.0045)
    cloak_texture(art/'cloak-albedo.png',paths)
    image=bpy.data.images.load(str(art/'cloak-albedo.png'),check_existing=True);image.pack()
    material=obj.data.materials[0];bsdf=material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Specular IOR Level'].default_value=.13
    tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    material.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
    obj['construction']='One continuous garment pattern. Open front edges become the arm-leading edges; the rear hem tucks to the waist in flight.'
    obj['cloth']='Glide / Flutter / Trail morphs, with fixed garment UVs and a 1.4 mm wall.'
    # Independent geometric checks catch a stretched neckline and a retained
    # calf-length central curtain in flight before the asset is delivered.
    def length(glide):return sum((point(i/100,0,glide)-point((i-1)/100,0,glide)).length for i in range(1,101))
    leading_ratio=length(1)/length(0)
    flight_center=point(0,1,1)
    audit={'pieces':1,'continuous_pattern':True,'leading_edge_rest_m':round(length(0),4),'leading_edge_flight_m':round(length(1),4),'leading_edge_stretch_ratio':round(leading_ratio,4),'flight_center_hem_y_m':round(flight_center.y,4),'flight_span_m':round(2*point(1,0,1).x,4),'wall_mm':1.4,'glyph_projection_max_error_mm':round(max(glyph_errors)*1000,3)}
    (art/'cloak-fit.json').write_text(json.dumps(audit,indent=2),encoding='utf-8')
    if leading_ratio>1.10:raise RuntimeError('Cape unfolding stretches its front edge too far.')
    if flight_center.y<.95:raise RuntimeError('Cape retains a hanging central curtain in flight.')
    if max(glyph_errors)>.005:raise RuntimeError('Painted emblems extend beyond the cloth panel.')
    flipped=0
    for j in range(nv):
        for i in range(nu):
            u=-.999+1.998*i/nu;un=-.999+1.998*(i+1)/nu
            p,a,b=point(u,j/nv,1),point(un,j/nv,1),point(u,(j+1)/nv,1)
            if (a.x-p.x)*(b.y-p.y)-(a.y-p.y)*(b.x-p.x)>1e-9:flipped+=1
    if flipped:raise RuntimeError(f'Unfolded cloth chart has {flipped} inverted cells.')
    print('CLOAK_FIT '+json.dumps(audit))
    return [obj]
