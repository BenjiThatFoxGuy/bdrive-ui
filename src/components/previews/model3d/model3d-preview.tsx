import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Spinner } from "@tw-material/react";
import clsx from "clsx";

import { center } from "@/utils/classes";
import { getExtension } from "@/utils/common";

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";

type RenderMode = "textured" | "lit" | "unlit" | "wireframe";
type BgMode = "dark" | "light" | "transparent";

interface ModelInfo {
  vertices: number;
  faces: number;
  dimensions: { x: number; y: number; z: number };
}

interface Model3DPreviewProps {
  assetUrl: string;
  name: string;
}

const BG_COLORS: Record<BgMode, number> = {
  dark: 0x1a1a2e,
  light: 0xf0f0f0,
  transparent: 0x000000,
};

const GRID_COLORS: Record<BgMode, [number, number]> = {
  dark: [0x444444, 0x333333],
  light: [0x999999, 0xcccccc],
  transparent: [0x444444, 0x333333],
};

function countGeometry(object: THREE.Object3D): ModelInfo {
  let vertices = 0;
  let faces = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geo = child.geometry;
      vertices += geo.attributes.position?.count ?? 0;
      if (geo.index) {
        faces += geo.index.count / 3;
      } else {
        faces += (geo.attributes.position?.count ?? 0) / 3;
      }
    }
  });
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  return {
    vertices,
    faces: Math.floor(faces),
    dimensions: {
      x: Math.round(size.x * 100) / 100,
      y: Math.round(size.y * 100) / 100,
      z: Math.round(size.z * 100) / 100,
    },
  };
}

function frameObject(camera: THREE.PerspectiveCamera, controls: OrbitControls, object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const ctr = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(ctr);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  const dist = maxDim / (2 * Math.tan(fov / 2)) * 1.5;

  camera.position.set(ctr.x + dist * 0.5, ctr.y + dist * 0.4, ctr.z + dist * 0.7);
  camera.near = dist * 0.01;
  camera.far = dist * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(ctr);
  controls.update();
}

/** Convert any material to MeshStandardMaterial for uniform mode-switching. */
function toStandardMaterial(src: THREE.Material): THREE.MeshStandardMaterial {
  if (src instanceof THREE.MeshStandardMaterial) return src;

  const std = new THREE.MeshStandardMaterial();

  if ("color" in src) std.color = (src as any).color?.clone?.() ?? std.color;
  if ("map" in src) std.map = (src as any).map ?? null;
  if ("normalMap" in src) std.normalMap = (src as any).normalMap ?? null;
  if ("alphaMap" in src) std.alphaMap = (src as any).alphaMap ?? null;
  if ("emissive" in src) std.emissive = (src as any).emissive?.clone?.() ?? std.emissive;
  if ("emissiveMap" in src) std.emissiveMap = (src as any).emissiveMap ?? null;
  if ("emissiveIntensity" in src) std.emissiveIntensity = (src as any).emissiveIntensity ?? 1;
  if ("specularMap" in src && (src as any).specularMap) {
    // Use specular map as a rough approximation for roughness
    std.roughness = 0.5;
  }
  if ("bumpMap" in src && (src as any).bumpMap) {
    std.normalMap = (src as any).bumpMap;
  }

  std.transparent = src.transparent;
  std.opacity = src.opacity;
  std.side = src.side;
  std.name = src.name;

  return std;
}

/** Convert all materials in a model to MeshStandardMaterial for uniform handling. */
function convertMaterials(model: THREE.Object3D): void {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.material) return;
    if (Array.isArray(child.material)) {
      child.material = child.material.map((m) =>
        m instanceof THREE.MeshStandardMaterial ? m : toStandardMaterial(m)
      );
    } else if (!(child.material instanceof THREE.MeshStandardMaterial)) {
      child.material = toStandardMaterial(child.material);
    }
  });
}

function getLoader(ext: string): ((url: string) => Promise<THREE.Object3D>) | null {
  switch (ext) {
    case "fbx":
      return async (url) => {
        const loader = new FBXLoader();
        // Set resource path so embedded textures resolve correctly
        const basePath = url.substring(0, url.lastIndexOf("/") + 1);
        loader.setResourcePath(basePath);
        const model = await loader.loadAsync(url);
        convertMaterials(model);
        return model;
      };
    case "gltf":
    case "glb":
      return async (url) => {
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(url);
        return gltf.scene;
      };
    case "obj":
      return async (url) => {
        const loader = new OBJLoader();
        const model = await loader.loadAsync(url);
        convertMaterials(model);
        return model;
      };
    case "stl":
      return async (url) => {
        const loader = new STLLoader();
        const geo = await loader.loadAsync(url);
        const mat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
        return new THREE.Mesh(geo, mat);
      };
    case "ply":
      return async (url) => {
        const loader = new PLYLoader();
        const geo = await loader.loadAsync(url);
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, vertexColors: geo.hasAttribute("color") });
        return new THREE.Mesh(geo, mat);
      };
    case "dae":
      return async (url) => {
        const loader = new ColladaLoader();
        const collada = await loader.loadAsync(url);
        const model = collada!.scene;
        convertMaterials(model);
        return model;
      };
    default:
      return null;
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Convert spherical (azimuth, elevation) in degrees to a unit-sphere position. */
function sphericalToCartesian(azimuthDeg: number, elevationDeg: number, radius: number): THREE.Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return new THREE.Vector3(
    radius * Math.cos(el) * Math.sin(az),
    radius * Math.sin(el),
    radius * Math.cos(el) * Math.cos(az),
  );
}

function Model3DPreview({ assetUrl, name }: Model3DPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const sceneRef = useRef<THREE.Scene>();
  const cameraRef = useRef<THREE.PerspectiveCamera>();
  const controlsRef = useRef<OrbitControls>();
  const modelRef = useRef<THREE.Object3D>();
  const ambientRef = useRef<THREE.AmbientLight>();
  const directionalRef = useRef<THREE.DirectionalLight>();
  const gridRef = useRef<THREE.GridHelper>();
  const animFrameRef = useRef<number>();

  // Deep-clone each mesh's material at load time so we can always restore it.
  const originalMaterials = useRef<Map<number, THREE.Material | THREE.Material[]>>(new Map());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>("textured");
  const [bgMode, setBgMode] = useState<BgMode>("transparent");
  const [lightIntensity, setLightIntensity] = useState(1.0);
  const [lightAzimuth, setLightAzimuth] = useState(45);
  const [lightElevation, setLightElevation] = useState(60);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const ext = useMemo(() => getExtension(name).toLowerCase(), [name]);

  /** Snapshot every mesh's material so we can restore it later. */
  const snapshotMaterials = useCallback((model: THREE.Object3D) => {
    originalMaterials.current.clear();
    model.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        if (Array.isArray(child.material)) {
          originalMaterials.current.set(child.id, child.material.map((m) => m.clone()));
        } else {
          originalMaterials.current.set(child.id, child.material.clone());
        }
      }
    });
  }, []);

  const applyRenderMode = useCallback((mode: RenderMode) => {
    const model = modelRef.current;
    if (!model) return;

    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      const saved = originalMaterials.current.get(child.id);

      switch (mode) {
        case "wireframe":
          child.material = new THREE.MeshBasicMaterial({
            wireframe: true,
            color: 0x00ff88,
          });
          break;

        case "unlit":
          // Restore from snapshot then force emissive so lights don't matter.
          if (saved) {
            child.material = Array.isArray(saved)
              ? saved.map((m) => m.clone())
              : saved.clone();
          }
          (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => {
            if ("emissive" in m && "emissiveIntensity" in m) {
              const std = m as THREE.MeshStandardMaterial;
              if (std.map) {
                // If there's a texture, use white emissive so the texture shows at full brightness
                std.emissive = new THREE.Color(0xffffff);
                std.emissiveMap = std.map;
                std.emissiveIntensity = 1.0;
              } else {
                std.emissive = std.color?.clone() ?? new THREE.Color(0xaaaaaa);
                std.emissiveIntensity = 0.5;
              }
              std.needsUpdate = true;
            }
          });
          break;

        case "textured":
        case "lit":
        default:
          // Restore from snapshot (clean copy).
          if (saved) {
            child.material = Array.isArray(saved)
              ? saved.map((m) => m.clone())
              : saved.clone();
          }
          break;
      }
    });
  }, []);

  // Initialize scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    // Default to transparent
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 10000);
    camera.position.set(5, 3, 5);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    ambientRef.current = ambient;

    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.copy(sphericalToCartesian(45, 60, 10));
    scene.add(directional);
    directionalRef.current = directional;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
    scene.add(hemi);

    // Grid
    const grid = new THREE.GridHelper(20, 20, ...GRID_COLORS.transparent);
    (grid.material as THREE.Material).opacity = 0.4;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);
    gridRef.current = grid;

    // Animation loop
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);
    const observer = new ResizeObserver(onResize);
    observer.observe(container);

    // Load model
    const loadModel = getLoader(ext);
    if (!loadModel) {
      setError(`Unsupported format: .${ext}`);
      setLoading(false);
      return;
    }

    loadModel(assetUrl)
      .then((model) => {
        scene.add(model);
        modelRef.current = model;

        setModelInfo(countGeometry(model));

        // Snapshot materials after a short delay so async texture loading
        // (especially in FBX files) has time to complete. Without this,
        // the snapshot captures materials with null texture maps.
        const doSnapshot = () => {
          snapshotMaterials(model);
        };
        // Check if any textures are still loading; if so, wait a frame
        let hasLoadingTextures = false;
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const m of mats) {
              if ((m as any).map?.image === undefined && (m as any).map !== null) {
                hasLoadingTextures = true;
              }
            }
          }
        });
        if (hasLoadingTextures) {
          // Give textures time to decode
          setTimeout(doSnapshot, 500);
        } else {
          doSnapshot();
        }
        frameObject(camera, controls, model);

        // Scale grid to model
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const gridSize = Math.ceil(maxDim * 3);
        scene.remove(grid);
        const newGrid = new THREE.GridHelper(gridSize, Math.min(gridSize, 40), ...GRID_COLORS.transparent);
        (newGrid.material as THREE.Material).opacity = 0.4;
        (newGrid.material as THREE.Material).transparent = true;
        newGrid.position.y = box.min.y;
        scene.add(newGrid);
        gridRef.current = newGrid;

        setLoading(false);
      })
      .catch((err) => {
        console.error("Model load error:", err);
        setError(`Failed to load model: ${err.message}`);
        setLoading(false);
      });

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [assetUrl, ext, snapshotMaterials]);

  // Update lighting intensity
  useEffect(() => {
    if (ambientRef.current) ambientRef.current.intensity = lightIntensity * 0.6;
    if (directionalRef.current) directionalRef.current.intensity = lightIntensity * 0.8;
  }, [lightIntensity]);

  // Update light direction
  useEffect(() => {
    if (directionalRef.current) {
      directionalRef.current.position.copy(sphericalToCartesian(lightAzimuth, lightElevation, 10));
    }
  }, [lightAzimuth, lightElevation]);

  // Update background
  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!scene || !renderer) return;
    if (bgMode === "transparent") {
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
    } else {
      scene.background = new THREE.Color(BG_COLORS[bgMode]);
      renderer.setClearColor(BG_COLORS[bgMode], 1);
    }
    if (gridRef.current) {
      const colors = GRID_COLORS[bgMode];
      (gridRef.current as any).colorCenterLine = new THREE.Color(colors[0]);
      (gridRef.current as any).colorGrid = new THREE.Color(colors[1]);
    }
  }, [bgMode]);

  // Update render mode
  useEffect(() => {
    applyRenderMode(renderMode);
  }, [renderMode, applyRenderMode]);

  // Auto-rotate
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = 2.0;
    }
  }, [autoRotate]);

  const resetCamera = useCallback(() => {
    if (modelRef.current && cameraRef.current && controlsRef.current) {
      frameObject(cameraRef.current, controlsRef.current, modelRef.current);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      el.requestFullscreen();
      setIsFullscreen(true);
    }
  }, []);

  // Whether the current mode uses lighting (show light controls)
  const showLightControls = renderMode === "lit" || renderMode === "textured";

  if (error) {
    return (
      <div className={clsx(center, "size-full flex-col gap-2 text-on-surface-variant")}>
        <span className="text-error text-lg">Failed to load 3D model</span>
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  return (
    <div className="relative size-full min-h-[400px] flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-low rounded-t-lg flex-wrap">
        {/* Render mode */}
        <div className="flex items-center gap-1 border-r border-outline-variant pr-2">
          {(["textured", "lit", "unlit", "wireframe"] as RenderMode[]).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={renderMode === mode ? "filled" : "text"}
              className="text-xs px-2 min-w-0 h-7"
              onPress={() => setRenderMode(mode)}
            >
              {mode}
            </Button>
          ))}
        </div>

        {/* Background */}
        <div className="flex items-center gap-1 border-r border-outline-variant pr-2">
          {(["dark", "light", "transparent"] as BgMode[]).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={bgMode === mode ? "filled" : "text"}
              className="text-xs px-2 min-w-0 h-7"
              onPress={() => setBgMode(mode)}
            >
              {mode === "transparent" ? "alpha" : mode}
            </Button>
          ))}
        </div>

        {/* Light controls - only for lit/textured modes */}
        {showLightControls && (
          <div className="flex items-center gap-2 border-r border-outline-variant pr-2">
            <span className="text-xs text-on-surface-variant">Light</span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={lightIntensity}
              onChange={(e) => setLightIntensity(Number.parseFloat(e.target.value))}
              className="w-14 h-1 accent-primary"
              title="Intensity"
            />
            <span className="text-xs text-on-surface-variant">Dir</span>
            <input
              type="range"
              min={0}
              max={360}
              step={5}
              value={lightAzimuth}
              onChange={(e) => setLightAzimuth(Number.parseInt(e.target.value))}
              className="w-14 h-1 accent-primary"
              title="Azimuth"
            />
            <input
              type="range"
              min={-10}
              max={90}
              step={5}
              value={lightElevation}
              onChange={(e) => setLightElevation(Number.parseInt(e.target.value))}
              className="w-14 h-1 accent-primary"
              title="Elevation"
            />
          </div>
        )}

        {/* Actions */}
        <Button size="sm" variant="text" className="text-xs px-2 min-w-0 h-7" onPress={() => setAutoRotate(!autoRotate)}>
          {autoRotate ? "stop" : "rotate"}
        </Button>
        <Button size="sm" variant="text" className="text-xs px-2 min-w-0 h-7" onPress={resetCamera}>
          reset
        </Button>
        <Button size="sm" variant="text" className="text-xs px-2 min-w-0 h-7" onPress={toggleFullscreen}>
          {isFullscreen ? "exit" : "fullscreen"}
        </Button>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 relative min-h-0">
        {loading && (
          <div className={clsx(center, "absolute inset-0 z-10 bg-surface/80")}>
            <Spinner size="lg" />
          </div>
        )}
      </div>

      {/* Model info - always visible */}
      {modelInfo && (
        <div className="flex items-center gap-4 px-3 py-1.5 bg-surface-container-low rounded-b-lg text-xs text-on-surface-variant">
          <span>
            <strong>{formatNumber(modelInfo.vertices)}</strong> vertices
          </span>
          <span>
            <strong>{formatNumber(modelInfo.faces)}</strong> faces
          </span>
          <span>
            {modelInfo.dimensions.x} x {modelInfo.dimensions.y} x {modelInfo.dimensions.z}
          </span>
          <span className="ml-auto uppercase text-primary">.{ext}</span>
        </div>
      )}
    </div>
  );
}

export default memo(Model3DPreview);
