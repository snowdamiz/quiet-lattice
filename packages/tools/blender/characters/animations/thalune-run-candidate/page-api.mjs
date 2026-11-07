// Appended to the frozen playback module, then serialized as one page program.
export function createPilotApi({ review, prepared, observation, originalRender, observedRender }) {
  const snapshot = () => prepared.targetProfile.bones.map(b => {
    const n=review.content.getObjectByName(b.name);
    return {name:b.name,position:n.position.toArray(),quaternion:n.quaternion.toArray(),scale:n.scale.toArray()};
  });
  observation.snapshot=snapshot;
  let selected=null,placementPending=true;
  return {
    async begin(species) {
      await prepared.people(species);
      selected=null;
      placementPending=true;
      observation.profile=prepared.targetProfile;
      return {people:review.file.split('/')[1],profileId:prepared.targetProfile.id,variant:review.sel.variant};
    },
    async frame(work) {
      if(review.liveOn || !review.held)throw Error('Review must remain held/live-off');
      if(placementPending || review.case!==work.light) {
        await review.light(work.light);
        placementPending=false;
      }
      if(review.lodLevel!==work.lod)review.lod(work.lod);
      if(!!review.wire!==work.wire)review.wireframe(work.wire);
      if(selected!==work.clip){prepared.clip(work.clip);selected=work.clip;}
      const selectedPose=prepared.seek(work.time);
      const intendedPose=snapshot(), before=observation.count;
      const dataUrl=review.capture();
      return {
        workId:work.id,reel:work.reel,frame:work.frame,sequenceTime:work.sequenceTime,
        actualPeople:review.file.split('/')[1],actualVariant:review.sel.variant,
        actualClip:selectedPose.clip,actualTime:selectedPose.time,clipDuration:selectedPose.duration,
        sourceProfileId:observation.sourceId,targetProfileId:prepared.targetProfile.id,
        actualLight:review.case,actualLod:review.lodLevel,actualWire:!!review.wire,
        renderCount:observation.count-before,intendedPose,atRender:observation.last,
        afterCapture:snapshot(),dataUrl,
      };
    },
    backend() {
      const gl=review.game.engine.renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
      return {version:gl.getParameter(gl.VERSION),renderer:gl.getParameter(gl.RENDERER),
        unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,
        vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,
        canvas:[review.game.engine.renderer.domElement.width,review.game.engine.renderer.domElement.height]};
    },
    dispose() {
      prepared.dispose();
      if(review.game.engine.render!==observedRender)throw Error('Observer render hook changed');
      review.game.engine.render=originalRender;
      const neutralRestored=!prepared.targetProfile || JSON.stringify(snapshot())===JSON.stringify(prepared.targetProfile.bones.map(b=>({
        name:b.name,position:b.position,quaternion:b.quaternion,scale:b.scale})));
      observation.snapshot=null;
      return {released:true,hookRestored:true,neutralRestored};
    },
  };
}

export async function installPilotPage({ manifest,binding,peopleHashes }) {
  const review=window.review, engine=review.game.engine;
  if(review.liveOn || !review.held)throw Error('Ordinary standard Review must be held/live-off');
  const originalRender=engine.render, observation={count:0,last:null,snapshot:null,sourceId:manifest.sourceProfileId};
  const observedRender=function(...args) {
    if(observation.snapshot) {
      review.root.updateWorldMatrix(true,true);
      observation.count++;
      observation.last={pose:observation.snapshot(),cameraWorld:review.game.engine.camera.matrixWorld.toArray(),
        reviewWorld:review.root.matrixWorld.toArray(),gameTime:review.game.time,reviewClock:review.clock};
    }
    return originalRender.apply(this,args);
  };
  engine.render=observedRender;
  try {
    const prepared=await prepareStandardReview({review,manifest,binding,peopleHashes});
    window.__t02Pilot=createPilotApi({review,prepared,observation,originalRender,observedRender});
    return {installed:true,sourceProfileId:manifest.sourceProfileId,standardReview:review.file};
  } catch(error) {
    if(engine.render===observedRender)engine.render=originalRender;
    throw error;
  }
}
