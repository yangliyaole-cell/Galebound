def build_head(context):
    globals().update(context)
    # Sculpted continuous head: the nose, brow, cheek and jaw are deformations of
    # one closed surface. A rounded occiput supplies genuine side-view depth.
    head=Surface('Traveler_Head')
    hy=P['head'].y
    profile=[(0,.006,.069,-.02),(.012,.028,.085,-.042),(.032,.053,.094,-.068),(.058,.075,.103,-.087),(.09,.087,.108,-.101),(.12,.09,.105,-.111),(.15,.09,.102,-.12),(.18,.088,.095,-.123),(.205,.077,.081,-.111),(.229,.056,.059,-.087),(.247,.023,.024,-.048),(.252,.001,-.014,-.018)]
    def profile_at(h):
        for a,b in zip(profile,profile[1:]):
            if h<=b[0]:
                t=(h-a[0])/(b[0]-a[0]);return tuple(a[j]*(1-t)+b[j]*t for j in (1,2,3))
        return profile[-1][1:]
    ns=80; rows=64
    for k in range(rows+1):
        h=.0001+(.2517)*k/rows; width,front,back=profile_at(h)
        for j in range(ns):
            a=2*pi*j/ns; x=width*sin(a); c=cos(a)
            z=((front+back)/2+(front-back)/2*c)
            frontal=smooth(.1,.65,c)
            # Anatomical planes instead of extra cheek/nose primitives.
            z+=frontal*(.009*exp(-(x/.018)**2-((h-.104)/.026)**2)
                +.004*exp(-(x/.018)**2-((h-.132)/.032)**2)
                +.007*exp(-((abs(x)-.054)/.019)**2-((h-.09)/.021)**2)
                -.007*exp(-((abs(x)-.037)/.024)**2-((h-.139)/.014)**2)
                +.004*exp(-((abs(x)-.035)/.035)**2-((h-.16)/.012)**2)
                +.004*exp(-(x/.028)**2-((h-.05)/.012)**2))
            head.vertex((x,hy+h,z),SKIN,'head')
    for k in range(rows):
        for j in range(ns):
            a=k*ns+j;b=k*ns+(j+1)%ns;head.face((a,b,b+ns,a+ns))
    head.face(tuple(reversed(range(ns))));head.face(tuple(rows*ns+j for j in range(ns)))
    head_obj=finish(head,.53,subdiv=1)
    neck=Surface('Traveler_Neck')
    neck.loft([(1.425,.046,.046,0,-.01),(1.465,.044,.044,0,-.012),(1.52,.037,.038,0,-.014),(1.575,.035,.038,0,-.013)],SKIN,'chest',48)
    for side in (-1,1):
        neck.ellipsoid((side*.091,hy+.122,-.023),(.014,.026,.013),SKIN,'head',32,16)
        neck.ellipsoid((side*.099,hy+.122,-.014),(.004,.016,.006),SKIN_SHADE,'head',20,12)
    finish(neck,.6)

    eye_y=hy+.14
    eyes=Surface('Traveler_Eyes'); features=Surface('Traveler_Face_Details')
    for side in (-1,1):
        x=side*.0365
        eyes.ellipsoid((x,eye_y,.086),(.020,.0102,.009),'#cec9b8','head',32,16)
        eyes.ellipsoid((x,eye_y,.094),(.0083,.0085,.0022),'#574638','head',28,16)
        eyes.ellipsoid((x,eye_y-.0005,.096),(.0068,.007,.0013),'#957950','head',24,12)
        eyes.ellipsoid((x,eye_y+.0005,.0972),(.0037,.0052,.001),'#142225','head',24,12)
        eyes.ellipsoid((x-.0028,eye_y+.0033,.0984),(.0016,.0016,.0005),'#eee9dc','head',16,10)
        for top in (1,-1):
            pts=[]
            for i in range(25):
                a=pi*i/24; pts.append((x+.0202*cos(a),eye_y+top*.009*sin(a)+side*.002*cos(a),.088+.007*sin(a)))
            eyes.tube(pts,.0017 if top==1 else .0011,SKIN_SHADE if top==1 else SKIN,'head',8)
        features.tube(bezier((x-side*.018,hy+.165,.103),(x-side*.008,hy+.17,.109),(x+side*.008,hy+.168,.103),(x+side*.019,hy+.161,.094),20),.0025,HAIR,'head',8,taper=lambda t:.4+.6*sin(pi*t))
    features.tube(bezier((-.018,hy+.052,.101),(-.007,hy+.05,.107),(.007,hy+.05,.107),(.018,hy+.053,.101),22),.0011,'#8c6359','head',8)
    for side in (-1,1):features.ellipsoid((side*.008,hy+.09,.128),(.003,.0015,.0013),'#9d7160','head',16,8)
    # Keep the anime eye patches, eyebrows and nostril marks on the actual
    # skin. The former detached ellipsoids protruded through a fitted mask.
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    tree=BVHTree.FromObject(head_obj,bpy.context.evaluated_depsgraph_get())
    def conform(data,kind):
        for i,co in enumerate(data.vertices):
            x,by,y=co;z=-by
            hit,_,_,_=tree.ray_cast(Vector((x,-1,y)),Vector((0,1,0)))
            if hit is None:continue
            offset=.0005+max(0,min(1,(z-.081)/.024))*.0008 if kind=='eyes' else .00065+max(0,min(1,(z-.09)/.04))*.00025
            data.vertices[i]=(x,hit.y-offset,y)
    conform(eyes,'eyes');conform(features,'features')
    eye_obj=finish(eyes,.62);finish(features,.86)
    eye_obj.shape_key_add(name='Basis'); blink=eye_obj.shape_key_add(name='Blink')
    for v in blink.data:
        v.co.z=eye_y+(v.co.z-eye_y)*.08
        hit,_,_,_=tree.ray_cast(Vector((v.co.x,-1,v.co.z)),Vector((0,1,0)))
        if hit is not None:v.co.y=hit.y-.0008
    blink.value=0
    eye_obj.active_shape_key_index=0

    return hy, eye_obj, head_obj, profile
