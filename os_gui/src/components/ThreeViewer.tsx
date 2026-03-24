// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function ThreeViewer({ url }: { url: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const initialPosRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const [loadError, setLoadError] = useState<string | null>(null);

  const resetView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.copy(initialPosRef.current);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const w = container.clientWidth || 400;
    const h = container.clientHeight || 300;

    const scene = new THREE.Scene();
    // Transparent - background comes from CSS 'var(--bg-secondary)'
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.0001, 10000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    hemi.position.set(0, 20, 0);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(5, 10, 7.5);
    scene.add(dir);

    // Derive base path + filename so Three.js won't mangle the Tauri asset:// URI
    let basePath = url;
    if (basePath.includes('%2F')) {
      const i = basePath.lastIndexOf('%2F');
      if (i > -1) basePath = basePath.slice(0, i + 3);
    } else {
      const i = basePath.lastIndexOf('/');
      if (i > -1) basePath = basePath.slice(0, i + 1);
    }
    const fileName = url.slice(basePath.length);

    const loader = new GLTFLoader();
    loader.setPath(basePath);
    loader.load(fileName, (gltf) => {
      // Wrap in pivot so centering doesn't pollute gltf.scene's own transform
      const pivot = new THREE.Group();
      pivot.add(gltf.scene);

      // Compute bbox BEFORE adding to scene to avoid parent-transform contamination
      const box = new THREE.Box3().setFromObject(pivot);
      const center = box.getCenter(new THREE.Vector3());
      const size   = box.getSize(new THREE.Vector3());

      // Shift so bbox center is exactly at world origin
      pivot.position.copy(center).negate();
      scene.add(pivot);

      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const fov    = camera.fov * (Math.PI / 180);
      const dist   = (maxDim / 2) / Math.tan(fov / 2) * 1.8;

      camera.near = maxDim * 0.001;
      camera.far  = maxDim * 1000;
      camera.updateProjectionMatrix();

      camera.position.set(0, maxDim * 0.3, dist);
      camera.lookAt(0, 0, 0);
      controls.target.set(0, 0, 0);
      controls.update();

      initialPosRef.current.copy(camera.position);
    }, undefined, (err: any) => {
      console.error('GLTF load error:', err);
      setLoadError(err?.message ?? String(err));
    });

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize observer — always correct the canvas to current container size
    const onResize = () => {
      const W = container.clientWidth;
      const H = container.clientHeight;
      if (!W || !H) return;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(frameId);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, [url]);

  if (loadError) {
    return (
      <div style={{ width: '100%', height: '100%', background: 'var(--bg-primary)', color: 'var(--error, #f38ba8)', padding: 20, fontFamily: 'monospace', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        <h3 style={{ marginTop: 0 }}>GLTF Loading Error</h3>
        {loadError}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={mountRef}
        style={{ width: '100%', height: '100%', borderRadius: 4, overflow: 'hidden', background: 'var(--bg-secondary, #16171e)' }}
      />
      <button
        onClick={resetView}
        title="Reset camera to default position"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'rgba(0,0,0,0.45)',
          color: 'var(--text-primary, #e4e6f0)',
          border: '1px solid var(--border, rgba(255,255,255,0.12))',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 12,
          cursor: 'pointer',
          backdropFilter: 'blur(6px)',
          lineHeight: 1.6,
        }}
      >
        ⟳ Reset View
      </button>
    </div>
  );
}
