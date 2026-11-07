const {createRequire}=require('node:module'), fs=require('node:fs');
const r=createRequire(process.cwd()+'/packages/tools/package.json');
const {NodeIO}=r('@gltf-transform/core');const {ALL_EXTENSIONS}=r('@gltf-transform/extensions');
(async()=>{const {MeshoptDecoder}=await import(r.resolve('meshoptimizer'));await MeshoptDecoder.ready;const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});const result={};
for(const species of ['thalune','ixari','ulgani']){
 const path=`packages/client/public/models/characters/${species}.glb`,data=fs.readFileSync(path), json=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
 const doc=await io.read(path), root=doc.getRoot();let issue=[],meshes=[],zeroWeights=0;const arr=[];
 for(const node of root.listNodes()){
  const mesh=node.getMesh();if(!mesh)continue;let tris=0,prims=[];
  for(const p of mesh.listPrimitives()){
   const position=p.getAttribute('POSITION'),weights=p.getAttribute('WEIGHTS_0'), joints=p.getAttribute('JOINTS_0');tris+=p.getIndices().getCount()/3;
   if(!weights||!joints||!node.getSkin())issue.push([node.getName(),'missing-skin']);
   if(weights)for(let i=0;i<weights.getCount();i++){weights.getElement(i,arr);let total=arr.reduce((a,b)=>a+b,0);if(total===0)zeroWeights++;if(!Number.isFinite(total)||Math.abs(total-1)>.005)issue.push([node.getName(),'weights',i,arr.slice()]);}
   if(joints)for(let i=0;i<joints.getCount();i++){joints.getElement(i,arr);if(arr.some(x=>x>=node.getSkin().listJoints().length||x<0))issue.push([node.getName(),'joint-index',i,arr.slice()]);}
   const targets=p.listTargets().map(t=>t.getAttribute('POSITION'));if(targets.some(x=>x.getCount()!==position.getCount()))issue.push([node.getName(),'bad-morph-count']);
   prims.push({material:p.getMaterial()?.getName(),vertices:position.getCount(),morphs:targets.length});
  }
  meshes.push({name:node.getName(),extras:node.getExtras(),triangles:tris,primitives:prims});
 }
 const images=json.images.map(im=>{const bv=json.bufferViews[im.bufferView],binStart=20+data.readUInt32LE(12)+8,buf=data.subarray(binStart+(bv.byteOffset||0),binStart+(bv.byteOffset||0)+bv.byteLength);return {mimeType:im.mimeType,magic:buf.subarray(0,12).toString('hex'),width:buf.readUInt32LE(20),height:buf.readUInt32LE(24),levels:buf.readUInt32LE(40),supercompression:buf.readUInt32LE(44)};});
 result[species]={issue,zeroWeights,meshCount:meshes.length,meshes,images,required:json.extensionsRequired,skins:root.listSkins().map(s=>({name:s.getName(),joints:s.listJoints().map(n=>({name:n.getName(),translation:n.getTranslation(),rotation:n.getRotation(),scale:n.getScale(),parent:n.getParentNode()?.getName()}))})),materials:json.materials,animations:json.animations?.length||0};
 console.log(species,meshes.length,'meshes',images.length,'textures','skinissues',issue.length,'zeroWeights',zeroWeights);
}
fs.writeFileSync('/tmp/characters-whole-review-sol-20261102/glb-audit.json',JSON.stringify(result,null,2));})();
