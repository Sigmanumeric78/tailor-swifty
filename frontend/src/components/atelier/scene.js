import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clamp01, drawCount } from './motion.js';

function disposeScene(scene) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach(x => x.dispose());
  materials.forEach(x => x.dispose());
  textures.forEach(x => { x.source?.data?.close?.(); x.dispose(); });
}

// A single owner for all WebGL resources. No globals, remote scripts, or render loop.
export async function createAtelierScene(host, { modelUrl, tapeUrl, signal, onError }) {
  let renderer, world, environment, ro, closed = false;
  function destroy() {
    if (closed) return;
    closed = true;
    ro?.disconnect();
    if (world) disposeScene(world);
    environment?.dispose();
    if (renderer) {
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    }
    signal.removeEventListener('abort', destroy);
  }
  function onLost(event) { event.preventDefault(); onError(); destroy(); }
  signal.addEventListener('abort', destroy, { once: true });
  try {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const [modelResponse, tapeResponse] = await Promise.all([
      fetch(modelUrl, { signal }), fetch(tapeUrl, { signal })
    ]);
    if (!modelResponse.ok || !tapeResponse.ok) throw Error('Atelier asset unavailable');
    const [binary, data] = await Promise.all([modelResponse.arrayBuffer(), tapeResponse.json()]);
    const gltf = await new GLTFLoader().parseAsync(binary, '');
    if (signal.aborted) { disposeScene(gltf.scene); throw new DOMException('Aborted', 'AbortError'); }
    world = new THREE.Scene();
    const rig = new THREE.Group(); world.add(rig); rig.add(gltf.scene);
    gltf.scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
      for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
        if (material) material.envMapIntensity = .7;
      }
    });
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    environment = pmrem.fromScene(room, .04);
    room.dispose(); pmrem.dispose(); world.environment = environment.texture;
    world.add(new THREE.HemisphereLight(0xfff8eb, 0x788075, 2));
    const key = new THREE.DirectionalLight(0xfff5df, 3); key.position.set(-3, 4, 5); world.add(key);
    const fill = new THREE.DirectionalLight(0xe4ecff, 1.2); fill.position.set(3, 1, 2); world.add(fill);
    const rim = new THREE.DirectionalLight(0xffe2ac, 2); rim.position.set(0, 3, -3); world.add(rim);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
    geometry.setIndex(data.indices); geometry.computeVertexNormals();
    const textureCanvas = document.createElement('canvas'); textureCanvas.width = 1024; textureCanvas.height = 128;
    const ctx = textureCanvas.getContext('2d');
    ctx.fillStyle = '#c5a469'; ctx.fillRect(0,0,1024,128);
    ctx.fillStyle = '#453b27'; ctx.font = '24px sans-serif';
    for(let i=0;i<64;i++) { const x=i*16; ctx.fillRect(x,0,1.5,i%5===0?40:22);ctx.fillRect(x,110,1.5,18);if(i%5===0)ctx.fillText(String(i),x+4,78); }
    const texture = new THREE.CanvasTexture(textureCanvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const ribbon = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map:texture, metalness:.35, roughness:.4, side:THREE.DoubleSide }));
    rig.add(ribbon);
    const camera = new THREE.PerspectiveCamera(32, 1, .1, 30); camera.position.set(.15,.04,5.4); camera.lookAt(0,0,0);
    let progress = 1;
    function render() {
      if (closed || signal.aborted) return;
      rig.rotation.y = -.16 + .32 * progress;
      geometry.setDrawRange(0, drawCount(progress, data.indices.length));
      renderer.render(world, camera);
    }
    function resize() {
      if (closed) return;
      const w=host.clientWidth, h=host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w,h,false); camera.aspect=w/h;
      // Keep the broad shoulders in frame at narrow aspect ratios.
      camera.position.z = Math.max(5.4, 4.35 / camera.aspect);
      camera.updateProjectionMatrix(); render();
    }
    ro = new ResizeObserver(resize);
    host.append(renderer.domElement); ro.observe(host); resize();
    return { setProgress(value) {progress=clamp01(value);render();}, destroy };
  } catch (error) { destroy(); throw error; }
}
