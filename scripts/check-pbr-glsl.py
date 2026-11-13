#!/usr/bin/env python3
"""Optional Linux/Mesa GLES compiler audit. First: node scripts/check-pbr.mjs --dump-glsl.
Uses system EGL/GLES via ctypes; no browser, package installation or screenshot.
"""
import ctypes as C, glob, sys
E=C.CDLL('libEGL.so.1');G=C.CDLL('libGLESv2.so.2')
E.eglGetProcAddress.argtypes=[C.c_char_p];E.eglGetProcAddress.restype=C.c_void_p
getPlatform=C.CFUNCTYPE(C.c_void_p,C.c_uint,C.c_void_p,C.POINTER(C.c_int))(E.eglGetProcAddress(b'eglGetPlatformDisplayEXT'))
d=getPlatform(0x31DD,None,None)
E.eglInitialize.argtypes=[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_int)];assert E.eglInitialize(d,None,None),'EGL initialize'
E.eglBindAPI(0x30A0)
a=(C.c_int*13)(0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3022,8,0x3038,0,0)
config=C.c_void_p();n=C.c_int();E.eglChooseConfig.argtypes=[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_void_p),C.c_int,C.POINTER(C.c_int)]
assert E.eglChooseConfig(d,a,C.byref(config),1,C.byref(n)) and n.value
E.eglCreateContext.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.POINTER(C.c_int)];E.eglCreateContext.restype=C.c_void_p
context=E.eglCreateContext(d,config,None,(C.c_int*3)(0x3098,3,0x3038));assert context
E.eglCreatePbufferSurface.argtypes=[C.c_void_p,C.c_void_p,C.POINTER(C.c_int)];E.eglCreatePbufferSurface.restype=C.c_void_p
surface=E.eglCreatePbufferSurface(d,config,(C.c_int*5)(0x3057,1,0x3056,1,0x3038));assert surface
E.eglMakeCurrent.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.c_void_p];assert E.eglMakeCurrent(d,surface,surface,context)
G.glCreateShader.argtypes=[C.c_uint];G.glCreateShader.restype=C.c_uint
G.glShaderSource.argtypes=[C.c_uint,C.c_int,C.POINTER(C.c_char_p),C.POINTER(C.c_int)]
G.glGetShaderiv.argtypes=[C.c_uint,C.c_uint,C.POINTER(C.c_int)]
G.glGetShaderInfoLog.argtypes=[C.c_uint,C.c_int,C.POINTER(C.c_int),C.c_void_p]
failures=0
compiled={}
paths=sorted(glob.glob('/tmp/galebound-pbr-glsl/*.frag')+glob.glob('/tmp/galebound-pbr-glsl/*.vert'))
assert paths, 'First run: node scripts/check-pbr.mjs --dump-glsl'
for path in paths:
 shader=G.glCreateShader(0x8B30 if path.endswith('.frag') else 0x8B31);src=C.c_char_p(open(path,'rb').read());G.glShaderSource(shader,1,C.byref(src),None);G.glCompileShader(shader)
 ok=C.c_int();G.glGetShaderiv(shader,0x8B81,C.byref(ok))
 if not ok.value:
  log=C.create_string_buffer(32768);G.glGetShaderInfoLog(shader,32768,None,log);print('FAIL',path,log.value.decode());failures+=1
 else:
  print('PASS',path)
  if '-full-' in path: compiled[path.rsplit('.',1)[0],path.rsplit('.',1)[1]]=shader
 if '-full-' not in path: G.glDeleteShader(shader)
G.glCreateProgram.restype=C.c_uint
G.glGetProgramiv.argtypes=[C.c_uint,C.c_uint,C.POINTER(C.c_int)]
G.glGetProgramInfoLog.argtypes=[C.c_uint,C.c_int,C.POINTER(C.c_int),C.c_void_p]
for name in sorted(set(key[0] for key in compiled)):
 if (name,'vert') not in compiled or (name,'frag') not in compiled: continue
 program=G.glCreateProgram()
 G.glAttachShader(program,compiled[name,'vert']);G.glAttachShader(program,compiled[name,'frag']);G.glLinkProgram(program)
 ok=C.c_int();G.glGetProgramiv(program,0x8B82,C.byref(ok))
 if not ok.value:
  log=C.create_string_buffer(32768);G.glGetProgramInfoLog(program,32768,None,log);print('FAIL link',name,log.value.decode());failures+=1
 else: print('PASS link',name)
 G.glDeleteProgram(program)
print(f'{"FAIL" if failures else "PASS"}: GLES compile/link audit ({failures} failures)')
sys.exit(bool(failures))
