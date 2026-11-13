"""A skewed folded fabric collar, with a low front and a raised rear."""
from math import sin,cos,pi
from mathutils import Vector
from hero_geometry import Surface

def build_cowl(finish,apply,arm):
    data=Surface('Traveler_Cowl');nr,ns=18,80
    rings=[(0,1.415,.112,.076),(.30,1.466,.138,.101),(.68,1.521,.122,.091),(1,1.59,.098,.077)]
    def at(v):
        for a,b in zip(rings,rings[1:]):
            if v<=b[0]:
                t=(v-a[0])/(b[0]-a[0]);return tuple(a[j]*(1-t)+b[j]*t for j in (1,2,3))
        return rings[-1][1:]
    for k in range(nr+1):
        v=k/nr;y,rx,rz=at(v)
        for j in range(ns):
            a=2*pi*j/ns;front=max(0,cos(a))
            h=y-.065*front**3*v**1.6+.012*sin(a+.3)*v-.018*front*(1-v)
            data.vertex((rx*sin(a),h,-.006+rz*cos(a)),'#302927' if v<.35 else '#39302c','chest')
    for k in range(nr):
        for j in range(ns):
            a=k*ns+j;b=k*ns+(j+1)%ns;data.face((a,b,b+ns,a+ns))
    # A fitted dark inner gaiter covers the neck behind the open wrap. The
    # collar can sit away from the chin without exposing a broad skin band.
    data.loft([(1.44,.043,.043,0,-.01),(1.50,.040,.041,0,-.012),(1.557,.037,.038,0,-.013)],'#262222','chest',48,caps=False)
    obj=finish(data,.98);obj.modifiers.clear()
    apply(obj,'SOLIDIFY','2.8 mm folded textile',thickness=.0028,offset=-1)
    modifier=obj.modifiers.new('Game skeleton','ARMATURE');modifier.object=arm
    # Curved overlapping front flap. Wide cloth planes and tapered ends make
    # a wrap, instead of the former rigid rectangular bar over a neck cylinder.
    fold=Surface('Traveler_Cowl_Fold');nu,nv=18,6
    a=Vector((-.132,1.538,.087));b=Vector((-.091,1.569,.071))
    c=Vector((.120,1.474,.12));d=Vector((.073,1.429,.135))
    for j in range(nv+1):
        v=j/nv
        for i in range(nu+1):
            u=i/nu
            p=(a*(1-v)+b*v)*(1-u)+(d*(1-v)+c*v)*u
            p.z+=.013*sin(pi*u)*sin(pi*v*.85)
            fold.vertex(p,'#3a302b' if v>.3 else '#302825','chest')
    for j in range(nv):
        for i in range(nu):
            p=j*(nu+1)+i;fold.face((p,p+1,p+nu+2,p+nu+1))
    f=finish(fold,.98);f.modifiers.clear()
    apply(f,'SOLIDIFY','Overlapping fabric edge',thickness=.002,offset=-1)
    modifier=f.modifiers.new('Game skeleton','ARMATURE');modifier.object=arm
    return obj,f
