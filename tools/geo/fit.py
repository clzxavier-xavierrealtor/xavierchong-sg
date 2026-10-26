import json, math
from shapely.geometry import Polygon
from shapely import affinity
cfg=json.load(open('../projects/thomson-reserve.json')); L=json.load(open('lot.json'))
s=1/cfg['plan']['pxPerM']
# plan px -> metres, plan image y down => use (x, y) as (east?, south?) before rotation
P=Polygon([(x*s,y*s) for x,y in cfg['outline']]).buffer(0)
T=Polygon(list(zip(L['lot'][0::2],L['lot'][1::2]))).buffer(0)
print('areas plan %.0f lot %.0f'%(P.area,T.area))
best=None
for k in (1.0,):
  for th in range(0,360,1):
    R=affinity.rotate(affinity.scale(P,k,k,origin='centroid'),th,origin='centroid',use_radians=False)
    R=affinity.translate(R,T.centroid.x-R.centroid.x,T.centroid.y-R.centroid.y)
    for dx in range(-30,31,5):
      for dz in range(-30,31,5):
        Q=affinity.translate(R,dx,dz); iou=Q.intersection(T).area/Q.union(T).area
        if not best or iou>best[0]: best=(iou,th,dx,dz)
print(best)
iou,th,dx,dz=best
# refine
for th2 in [th+d/4 for d in range(-8,9)]:
  R=affinity.rotate(P,th2,origin='centroid')
  R=affinity.translate(R,T.centroid.x-R.centroid.x,T.centroid.y-R.centroid.y)
  for ddx in range(dx-6,dx+7):
    for ddz in range(dz-6,dz+7):
      Q=affinity.translate(R,ddx,ddz); i=Q.intersection(T).area/Q.union(T).area
      if i>best[0]: best=(i,th2,ddx,ddz)
print('refined',best)
iou,th,dx,dz=best
c=P.centroid; R=affinity.rotate(P,th,origin='centroid'); off=(T.centroid.x-R.centroid.x+dx, T.centroid.y-R.centroid.y+dz)
json.dump({'rotDeg':th,'planCentroidM':[c.x,c.y],'offset':off,'iou':iou},open('fit.json','w'))
# transform function check: MRT exit 2 location of plan icon px (1405,745)
def tf(px,py):
  x,y=px*s,py*s; x-=c.x; y-=c.y; a=math.radians(th); xr=x*math.cos(a)-y*math.sin(a); yr=x*math.sin(a)+y*math.cos(a)
  return xr+c.x+off[0], yr+c.y+off[1]
print('plan MRT icon ->',tf(1405,745),' OSM exit2 (191,111)')
print('Blk7 stack 32 ->',tf(380,572),' Blk1 stack 05 ->',tf(1275,729))
