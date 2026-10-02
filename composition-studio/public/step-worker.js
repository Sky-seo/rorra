importScripts('/vendor/occt-import-js.js');
const engine = occtimportjs({ locateFile: name => '/vendor/' + name });
onmessage = async ({data}) => {
  try {
    const occt = await engine;
    const result = occt.ReadStepFile(new Uint8Array(data), {linearUnit:'millimeter',linearDeflectionType:'bounding_box_ratio',linearDeflection:0.0002,angularDeflection:0.15});
    if (!result.success || !result.meshes.length) throw new Error('No displayable meshes found in the STEP file.');
    postMessage({meshes:result.meshes});
  } catch (error) { postMessage({error: String(error.message || error)}); }
};
