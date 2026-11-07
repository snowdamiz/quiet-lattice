"""Paint localized surface relief into the saved tool atlas after CPU inspection.

Shell growth, crystal fractures, and membrane veins follow the part UVs; contact
polish and joint occlusion stay at grips/rims. No random or uniform noise overlay.
"""
from pathlib import Path
import bpy
import numpy as np

scene=bpy.context.scene;p=scene['viewmodel_people'];source=Path(bpy.data.filepath)
assert source.parent.name=='viewmodels'
N=2048;y,x=np.mgrid[0:N,0:N].astype(np.float32)
u=np.clip(((x%512)-20)/471,0,1);v=np.clip(((y%512)-20)/471,0,1)
cell=((y//512)*4+x//512).astype(int)%8
rim=np.exp(-np.minimum.reduce([u,v,1-u,1-v])*45)
height=-.016*rim
if p=='thalune':
    radius=np.sqrt((u-.5)**2+(v+.2)**2)
    growth=np.exp(-((radius*9)%1-.5)**2/.012)
    height+=.018*growth*((cell==0)|(cell==4))*np.sin(u*np.pi)**2
elif p=='ixari':
    fracture=np.exp(-((u-(.34+.13*np.tanh((v-.4)*25)-.09*np.tanh((v-.72)*30)))/.013)**2)
    terrace=np.exp(-((v-.35)/.018)**2)+np.exp(-((v-.69)/.016)**2)
    height-=.025*fracture*((cell==1)|(cell==2))+.009*terrace*(cell==1)
else:
    veins=np.exp(-((u-.5)/.018)**2)
    for sign in (-1,1):
        veins+=np.exp(-((u-(.5+sign*.45*np.clip(v-.25,0,1)))/.016)**2)
    height+=.023*veins*(cell==1)
    height-=.015*np.exp(-((u-(.17+.04*np.sin(v*7)))/.017)**2)*(cell==0)
height+=.014*np.sin(u*100)*np.sin(v*np.pi)**4*(cell==3)
gx=np.gradient(height,axis=1)*90;gy=np.gradient(height,axis=0)*90
normal=np.ones((N,N,4),np.float32);normal[:,:,0]=.5-gx;normal[:,:,1]=.5-gy;normal[:,:,2]=1
normal[:,:,:3]=np.clip(normal[:,:,:3],0,1)
im=bpy.data.images[f'VM_{p}_normal'];im.pixels.foreach_set(normal.ravel());im.pack()
im=bpy.data.images[f'VM_{p}_orm'];data=np.empty(N*N*4,np.float32);im.pixels.foreach_get(data);data=data.reshape(N,N,4)
data[:,:,0]=np.clip(1-.32*rim-4*np.maximum(-height,0),.45,1)
data[:,:,1]=np.clip(data[:,:,1]+.11*rim-2*np.maximum(height,0),.22,.9)
im.pixels.foreach_set(data.ravel());im.pack()
scene['viewmodel_tool_relief']='part-local shell growth / crystal fractures / membrane veins; joint AO'
bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
