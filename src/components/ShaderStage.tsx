import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  Color,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderer,
} from "three";
import { ambientFragmentShader } from "../shaders/ambientFragment";
import { ambientVertexShader } from "../shaders/ambientVertex";
import type { BlobConfig, MeshConfig } from "../types";

export type ShaderStageHandle = {
  capturePng: (scale?: number) => string | null;
  captureThumbnail: (maxSize?: number) => string | null;
  getCanvas: () => HTMLCanvasElement | null;
  getCurrentMesh: () => MeshConfig;
};

type ShaderStageProps = {
  backgroundColor: string;
  blobs: BlobConfig[];
  isPaused: boolean;
  mesh: MeshConfig;
};

export const ShaderStage = forwardRef<ShaderStageHandle, ShaderStageProps>(
function ShaderStage(
  { backgroundColor, blobs, isPaused, mesh }: ShaderStageProps,
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const materialRef = useRef<ShaderMaterial | null>(null);
  const elapsedFrameRef = useRef(0);
  const isPausedRef = useRef(isPaused);
  const lastRenderTimeRef = useRef<number | null>(null);
  const meshRef = useRef(mesh);
  const previousFrameRef = useRef(mesh.frame);

  useImperativeHandle(ref, () => ({
    capturePng: (scale = 1) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return null;
      }

      if (scale <= 1) {
        return canvas.toDataURL("image/png");
      }

      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = Math.max(1, Math.round(canvas.width * scale));
      exportCanvas.height = Math.max(1, Math.round(canvas.height * scale));

      const context = exportCanvas.getContext("2d");

      if (!context) {
        return null;
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
      return exportCanvas.toDataURL("image/png");
    },
    captureThumbnail: (maxSize = 360) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return null;
      }

      const scale = Math.min(maxSize / canvas.width, maxSize / canvas.height, 1);
      const thumbnail = document.createElement("canvas");
      thumbnail.width = Math.max(1, Math.round(canvas.width * scale));
      thumbnail.height = Math.max(1, Math.round(canvas.height * scale));

      const context = thumbnail.getContext("2d");

      if (!context) {
        return null;
      }

      context.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
      return thumbnail.toDataURL("image/png");
    },
    getCanvas: () => canvasRef.current,
    getCurrentMesh: () => ({
      ...meshRef.current,
      frame: meshRef.current.frame + elapsedFrameRef.current,
    }),
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const renderer = new WebGLRenderer({
      alpha: false,
      antialias: true,
      canvas,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new PlaneGeometry(2, 2);
    const safeBlobs = normalizeBlobs(blobs);

    const material = new ShaderMaterial({
      fragmentShader: ambientFragmentShader,
      uniforms: {
        uBackgroundColor: { value: new Color(backgroundColor) },
        uBlobColor0: { value: new Color(safeBlobs[0].color) },
        uBlobColor1: { value: new Color(safeBlobs[1].color) },
        uBlobColor2: { value: new Color(safeBlobs[2].color) },
        uBlobShape0: { value: blobShapeVector(safeBlobs[0]) },
        uBlobShape1: { value: blobShapeVector(safeBlobs[1]) },
        uBlobShape2: { value: blobShapeVector(safeBlobs[2]) },
        uBlobTransform0: { value: blobTransformVector(safeBlobs[0]) },
        uBlobTransform1: { value: blobTransformVector(safeBlobs[1]) },
        uBlobTransform2: { value: blobTransformVector(safeBlobs[2]) },
        uMeshParams: { value: meshParamsVector(mesh) },
        uMeshScale: { value: mesh.scale },
        uMotionBlur: { value: mesh.motionBlur },
        uResolution: { value: new Vector2(1, 1) },
        uTime: { value: mesh.frame * 0.001 },
      },
      vertexShader: ambientVertexShader,
    });

    materialRef.current = material;
    scene.add(new Mesh(geometry, material));

    const resize = () => {
      const { clientHeight, clientWidth } = canvas;
      renderer.setSize(clientWidth, clientHeight, false);
      material.uniforms.uResolution.value.set(clientWidth, clientHeight);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    let frameId = 0;

    const render = (now: number) => {
      const activeMesh = meshRef.current;
      const lastRenderTime = lastRenderTimeRef.current ?? now;
      const delta = now - lastRenderTime;
      lastRenderTimeRef.current = now;

      if (!isPausedRef.current) {
        elapsedFrameRef.current += delta * activeMesh.speed;
      }

      material.uniforms.uTime.value =
        (activeMesh.frame + elapsedFrameRef.current) * 0.001;
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(render);
    };

    frameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      materialRef.current = null;
    };
  }, []);

  useEffect(() => {
    const material = materialRef.current;

    if (!material) {
      return;
    }

    material.uniforms.uBackgroundColor.value.set(backgroundColor);
  }, [backgroundColor]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    const material = materialRef.current;

    if (mesh.frame !== previousFrameRef.current) {
      elapsedFrameRef.current = 0;
      previousFrameRef.current = mesh.frame;
    }

    meshRef.current = mesh;

    if (!material) {
      return;
    }

    material.uniforms.uMeshParams.value.copy(meshParamsVector(mesh));
    material.uniforms.uMeshScale.value = mesh.scale;
    material.uniforms.uMotionBlur.value = mesh.motionBlur;
  }, [mesh]);

  useEffect(() => {
    const material = materialRef.current;

    if (!material) {
      return;
    }

    const safeBlobs = normalizeBlobs(blobs);
    applyBlobUniform(material, 0, safeBlobs[0]);
    applyBlobUniform(material, 1, safeBlobs[1]);
    applyBlobUniform(material, 2, safeBlobs[2]);
  }, [blobs]);

  return <canvas ref={canvasRef} className="shader-stage" aria-label="Mesh preview" />;
});

ShaderStage.displayName = "ShaderStage";

function normalizeBlobs(blobs: BlobConfig[]) {
  if (blobs.length >= 3) {
    return blobs;
  }

  const fallback = blobs[0] ?? {
    bend: 0,
    color: "#eeeeee",
    id: "fallback",
    name: "Blob",
    opacity: 0.5,
    rotation: 0,
    size: 0.3,
    stretch: 1,
    taper: 0,
    x: 0.5,
    y: 0.5,
  };

  return [fallback, fallback, fallback];
}

function blobShapeVector(blob: BlobConfig) {
  return new Vector4(blob.x, blob.y, blob.size, blob.opacity);
}

function blobTransformVector(blob: BlobConfig) {
  return new Vector4(blob.stretch, blob.rotation, blob.bend, blob.taper);
}

function meshParamsVector(mesh: MeshConfig) {
  return new Vector4(
    mesh.distortion,
    mesh.swirl,
    mesh.grainMixer,
    mesh.grainOverlay,
  );
}

function applyBlobUniform(
  material: ShaderMaterial,
  index: 0 | 1 | 2,
  blob: BlobConfig,
) {
  material.uniforms[`uBlobColor${index}`].value.set(blob.color);
  material.uniforms[`uBlobShape${index}`].value.set(
    blob.x,
    blob.y,
    blob.size,
    blob.opacity,
  );
  material.uniforms[`uBlobTransform${index}`].value.set(
    blob.stretch,
    blob.rotation,
    blob.bend,
    blob.taper,
  );
}
