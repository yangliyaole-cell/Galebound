"""Small original material maps for the supplied design; no external libraries."""
from pathlib import Path
import struct,zlib
import numpy as np

def mask_texture(path,outline,size=1024):
    x=np.linspace(-.105,.105,size,dtype=np.float32)[None,:]
    h=np.linspace(.255,0,size,dtype=np.float32)[:,None]
    inside=np.zeros((size,size),dtype=bool)
    for (ax,ay),(bx,by) in zip(outline,outline[1:]+outline[:1]):
        if abs(by-ay)<1e-10:continue
        inside^=((ay>h)!=(by>h))&(x<(bx-ax)*(h-ay)/(by-ay)+ax)
    pixels=np.empty((size,size,3),dtype=np.uint8);pixels[:]=(232,221,209);pixels[inside]=(188,154,112)
    def chunk(kind,body):return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body)&0xffffffff)
    raw=b''.join(b'\0'+row.tobytes() for row in pixels)
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')
    Path(path).write_bytes(png)

def cloak_texture(path,paths,size=2048):
    """Paint sewn gold graphics on stable garment UVs, on both cloth sides."""
    pixels=np.empty((size,size,3),dtype=np.uint8);pixels[:]=(55,46,42)
    # Very restrained dye variation, without shiny vertical plastic stripes.
    yy,xx=np.indices((size,size),dtype=np.float32)
    shade=(.9*np.sin(xx*.014)+.45*np.sin(yy*.019+xx*.006)).astype(np.int16)
    for channel in range(3):pixels[:,:,channel]=np.clip(pixels[:,:,channel].astype(np.int16)+shade,0,255)
    for points,width in paths:
        for a,b in zip(points,points[1:]):
            ax,ay=(a[0]+1)*.5*(size-1),a[1]*(size-1)
            bx,by=(b[0]+1)*.5*(size-1),b[1]*(size-1)
            radius=max(1,width*size*.5)
            x0=max(0,int(min(ax,bx)-radius-2));x1=min(size,int(max(ax,bx)+radius+3))
            y0=max(0,int(min(ay,by)-radius-2));y1=min(size,int(max(ay,by)+radius+3))
            if x1<=x0 or y1<=y0:continue
            y,x=np.mgrid[y0:y1,x0:x1].astype(np.float32)
            dx,dy=bx-ax,by-ay
            t=np.clip(((x-ax)*dx+(y-ay)*dy)/max(1e-8,dx*dx+dy*dy),0,1)
            distance=np.sqrt((x-(ax+dx*t))**2+(y-(ay+dy*t))**2)
            alpha=np.clip(radius+.6-distance,0,1)[:,:,None]
            patch=pixels[y0:y1,x0:x1].astype(np.float32)
            pixels[y0:y1,x0:x1]=(patch*(1-alpha)+np.array([184,151,110])*alpha).astype(np.uint8)
    def chunk(kind,body):return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body)&0xffffffff)
    raw=b''.join(b'\0'+row.tobytes() for row in pixels)
    Path(path).write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b''))
