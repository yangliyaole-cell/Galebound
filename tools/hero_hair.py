"""Layered anime hair sheets with a shallow crown and genuinely thin edges."""
from math import sin,cos,pi,sqrt
from mathutils import Vector
from hero_geometry import Surface,bezier

def build_hair(finish,hy,hair_color):
    hair=Surface('Traveler_Hair')
    # The dark scalp is only an underlay. Layered sheets cover its whole crown.
    ns,nr=56,24
    for k in range(nr+1):
        t=(k+.001)/(nr+.002)
        for j in range(ns):
            a=2*pi*j/ns;theta=t*(1.68-.98*cos(a))
            hair.vertex((.108*sin(theta)*sin(a),hy+.142+.127*cos(theta),-.019+.126*sin(theta)*cos(a)),'#292321','head')
    for k in range(nr):
        for j in range(ns):
            a=k*ns+j;b=k*ns+(j+1)%ns;hair.face((a,b,b+ns,a+ns))
    hair.face(tuple(reversed(range(ns))));hair.face(tuple(nr*ns+j for j in range(ns)))
    sheet_count=0;max_depth=0
    def sheet(control,width,depth=.0028,color=hair_color,tilt=0):
        nonlocal sheet_count,max_depth
        points=[Vector(p) for p in bezier(*[(x,hy+y,z) for x,y,z in control],16)]
        base=len(hair.vertices);cross=6;rows=len(points)
        for layer in (0,1):
            for k,p in enumerate(points):
                t=k/(rows-1)
                tangent=(points[min(k+1,rows-1)]-points[max(0,k-1)]).normalized()
                normal=Vector((p.x,(p.y-hy-.135)*1.1,p.z+.02)).normalized()
                across=tangent.cross(normal).normalized()
                if across.length<.1:across=Vector((1,0,0))
                normal=across.cross(tangent).normalized()
                # Broad blade which narrows abruptly toward a pointed end.
                taper=max(.006,(.66+.45*sin(pi*t))*(1-t)**.62)
                for j in range(cross+1):
                    u=-1+2*j/cross
                    crown=depth*(1-u*u)*(1-.35*t)
                    thickness=.0009 if layer==1 else 0
                    asym=1+tilt*u*.22
                    point=p+across*(width*taper*u*asym)+normal*(crown-thickness)
                    tone=color if j<cross*.48 else '#3a302a' if j<cross*.81 else '#302823'
                    hair.vertex(point,tone,'head')
        layer_size=rows*(cross+1)
        for layer in (0,1):
            for k in range(rows-1):
                for j in range(cross):
                    a=base+layer*layer_size+k*(cross+1)+j
                    face=(a,a+1,a+cross+2,a+cross+1)
                    hair.face(face if layer==0 else tuple(reversed(face)))
        boundary=list(range(cross+1))+[k*(cross+1)+cross for k in range(1,rows)]+[(rows-1)*(cross+1)+j for j in range(cross-1,-1,-1)]+[k*(cross+1) for k in range(rows-2,0,-1)]
        for a,b in zip(boundary,boundary[1:]+boundary[:1]):hair.face((base+a,base+b,base+b+layer_size,base+a+layer_size))
        sheet_count+=1;max_depth=max(max_depth,depth+.0009)
    # Main sweep: wide, asymmetrical, overlapping facets. The center crest of
    # the mask remains exposed, as in the supplied face turnaround.
    locks=[
      ([(-.005,.254,.003),(-.053,.269,.064),(-.115,.202,.102),(-.089,.135,.11)],.045,.0034,'#46382f',-.3),
      ([(-.039,.231,.043),(-.081,.238,.104),(-.076,.171,.123),(-.119,.132,.079)],.036,.0028,hair_color,.4),
      ([(-.045,.251,.004),(-.065,.246,.084),(-.08,.224,.118),(-.071,.199,.12)],.022,.0028,'#40322b',-.2),
      ([(.046,.246,.009),(.092,.247,.057),(.113,.193,.102),(.081,.149,.116)],.039,.003,hair_color,.3),
      ([(.079,.205,.026),(.126,.181,.058),(.128,.105,.081),(.100,.063,.067)],.032,.0025,'#3b302b',.1),
      ([(-.08,.208,.018),(-.124,.183,.05),(-.128,.107,.067),(-.100,.062,.058)],.035,.0025,hair_color,-.2),
    ]
    for p,w,d,c,t in locks:sheet(p,w,d,c,t)
    # Crown plates run from an off-center part over the round skull; shallow
    # overlapping planes carry the silhouette rather than a smooth helmet.
    for i in range(14):
        a=.5+i*2*pi/14
        if cos(a)>.35:continue
        x=.09*sin(a);z=-.02+.105*cos(a)
        endx=.126*sin(a+.25);endz=-.02+.137*cos(a+.25)
        sheet([(-.016,.251,-.024),(x*.65,.283,z*.65),(endx,.20,endz),(endx+.025*sin(a+1.3),.142+.022*sin(i*1.9),endz+.016*cos(a+1.1))],.035,.0026,hair_color,(-1)**i*.3)
    sheet([(.02,.266,-.005),(-.05,.268,.08),(-.09,.238,.119),(-.115,.19,.10)],.033,.0025,'#45372e',-.3)
    sheet([(.03,.26,.005),(.065,.263,.055),(.09,.24,.11),(.113,.204,.10)],.033,.0025,hair_color,.2)
    sheet([(-.018,.263,.015),(-.035,.259,.095),(-.078,.218,.137),(-.068,.166,.129)],.028,.0025,'#45372e',-.2)
    sheet([(.032,.26,.015),(.045,.248,.093),(.073,.218,.135),(.062,.176,.128)],.027,.0025,hair_color,.2)
    # Short, wide side layers splay out into thin irregular points, not hanging
    # cylinders. Their broad face is oriented away from the scalp.
    for side in (-1,1):
        for i in range(4):
            z=.031-i*.045
            sheet([(side*.072,.213,z),(side*.118,.194,z-.007),(side*.139,.141,z-.02),(side*(.151+.008*sin(i)),.13-.022*i,z-.035)],.031,.0023,hair_color,side*.5)
        for i in range(3):
            z=.015-i*.065
            sheet([(side*.08,.17,z),(side*.124,.16,z-.006),(side*.143,.105,z-.012),(side*.158,.121-.022*i,z-.026)],.023,.0019,'#3a2e28',-.4)
    for i,x in enumerate((-.085,-.05,-.015,.022,.057,.085)):
        sheet([(x*.7,.178,-.112),(x,.136,-.153),(x+.011,.079,-.151),(x+.017,.037+.012*(i%3),-.131)],.025,.0023,hair_color,.3)
    # One narrow cowlick, built as a sheet with a sub-millimetre edge.
    sheet([(-.012,.265,-.023),(.005,.298,-.025),(.004,.32,-.04),(-.016,.309,-.049)],.008,.0011,'#302620')
    sheet([(-.045,.248,-.04),(-.085,.278,-.052),(-.104,.268,-.072),(-.111,.284,-.082)],.012,.0012,'#3c2e27')
    obj=finish(hair,.94)
    # A shallow planar cross-section remains readable in both Blender and the
    # game. Do not subdivide it back into rounded tube-like locks.
    for face in obj.data.polygons:face.use_smooth=True
    bsdf=obj.data.materials[0].node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Specular IOR Level'].default_value=.12
    obj['construction']='Layered thin hair sheets: 0.9 mm edge, 1.1–3.4 mm shallow crown. No elliptical tubes.'
    obj['sheet_count']=sheet_count;obj['max_sheet_depth_mm']=round(max_depth*1000,3)
    return obj
