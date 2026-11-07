#include <math.h>
void raster(float *t,int n,unsigned char *owner,float *wear,unsigned char *conflict){
 for(int k=0;k<n;k++,t+=13){
 float ax=t[0],ay=t[1],bx=t[2],by=t[3],cx=t[4],cy=t[5],den=(bx-ax)*(cy-ay)-(cx-ax)*(by-ay);
 if(fabsf(den)<1e-8)continue;
 int x0=fmaxf(0,floorf(fminf(ax,fminf(bx,cx)))),x1=fminf(4095,ceilf(fmaxf(ax,fmaxf(bx,cx))));
 int y0=fmaxf(0,floorf(fminf(ay,fminf(by,cy)))),y1=fminf(4095,ceilf(fmaxf(ay,fmaxf(by,cy))));
 for(int y=y0;y<=y1;y++)for(int x=x0;x<=x1;x++){
 float dx=x+.5f-ax,dy=y+.5f-ay,b=(dx*(cy-ay)-dy*(cx-ax))/den,c=((bx-ax)*dy-(by-ay)*dx)/den,a=1-b-c;
 if(a<0||b<0||c<0)continue;
 int i=y*4096+x,r=(int)t[12];if(owner[i]&&owner[i]!=r)conflict[i]=1;owner[i]=r;
 float e=0;if(t[6]>0)e=fmaxf(e,1-a*t[6]/.012f);if(t[7]>0)e=fmaxf(e,1-b*t[7]/.012f);if(t[8]>0)e=fmaxf(e,1-c*t[8]/.012f);
 float z=a*t[9]+b*t[10]+c*t[11],salt=fmaxf(0,fminf(.5f,(-.25f-z)/1.5f));float w=e*(.24f+salt*.35f);wear[i]=fminf(wear[i],w);
 }
 }
}
