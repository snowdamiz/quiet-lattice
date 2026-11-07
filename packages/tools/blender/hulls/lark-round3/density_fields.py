"""Original editable R3 paint/livery control fields, kept separate from texture sampling artifacts."""
import numpy as np
ROLES=['Hull','Accent','Trim','Dark']
BASE=np.array([[.67,.62,.49],[.027,.27,.23],[.055,.13,.17],[.035,.047,.052]])
PALETTES={'compact':['#F4F4F0','#22406A','#F28C28'],'working':['#9A968C','#3A3B3D','#E3B341']}
def srgb(v):return np.where(v<=.0031308,12.92*v,1.055*np.maximum(v,0)**(1/2.4)-.055)
def linear(v):return np.where(v<=.04045,v/12.92,((v+.055)/1.055)**2.4)
def alternate(color,roles,scheme):
 out=color.copy()
 for role,h in enumerate(PALETTES[scheme]):
  rgb=linear(np.array([int(h[i:i+2],16)/255 for i in [1,3,5]]));selected=roles==role;out[selected,:3]=np.clip(color[selected,:3]/BASE[role]*rgb,0,1)
 return out
def comparison(color,orm,roles,base):
 arrays=[srgb(color[:,:3]),orm[:,1:3]]
 if base:arrays += [srgb(alternate(color,roles,s)[:,:3]) for s in PALETTES]
 return np.concatenate(arrays,axis=1)
