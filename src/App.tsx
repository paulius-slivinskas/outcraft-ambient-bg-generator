import { ShaderStage, type ShaderStageHandle } from "./components/ShaderStage";
import { Button } from "./components/ui/button";
import { Slider } from "./components/ui/slider";
import {
  fixedGrainMixer,
  fixedGrainOverlay,
  initialBackgroundColor,
  initialBlobs,
  initialMesh,
  paletteGroups,
} from "./data/palette";
import { cn } from "./lib/utils";
import type {
  BlobConfig,
  FormatConfig,
  GallerySection,
  MeshConfig,
  OverlayAsset,
  OverlayTone,
  VisualSnapshot,
  VisualOverlay,
} from "./types";
import {
  Check,
  Heart,
  Moon,
  Palette,
  Pause,
  Play,
  Shapes,
  Shuffle,
  Sun,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

const singleFormatOptions = [
  { height: 1, label: "1:1", name: "Square", width: 1 },
  { height: 3, label: "2:3", name: "Portrait", width: 2 },
  { height: 2, label: "3:2", name: "Landscape", width: 3 },
  { height: 4, label: "3:4", name: "Portrait", width: 3 },
  { height: 3, label: "4:3", name: "Landscape", width: 4 },
  { height: 16, label: "9:16", name: "Story", width: 9 },
  { height: 9, label: "16:9", name: "Wide", width: 16 },
] as const;

const allFormatsOption = {
  height: 1,
  label: "All",
  name: "Artboard",
  width: 1,
} as const;
const fullscreenFormatOption = {
  height: 1,
  label: "Fullscreen",
  name: "Mode",
  width: 1,
} as const;
const formatOptions = [
  ...singleFormatOptions,
  allFormatsOption,
  fullscreenFormatOption,
] as const;
const meshFrameMax = 500000;
const frameScrubFramesPerPixel = 5;
const videoDurationOptions = [15, 30, 60] as const;
const defaultVisualOverlay: VisualOverlay = {
  asset: "none",
  tone: "light",
};

type FormatOption = (typeof formatOptions)[number];
type SingleFormatOption = (typeof singleFormatOptions)[number];
type ActiveTab = "generate" | "gallery";
type VideoDuration = (typeof videoDurationOptions)[number];
type VideoExportFormat = "webm" | "mp4";
type VideoExportOptions = {
  durationSeconds: VideoDuration;
  isLoopable: boolean;
};
type GallerySaveStatus = "loading" | "saving" | "saved" | "error";
type UiTheme = "light" | "dark";
type ExportTarget = {
  format: SingleFormatOption;
  handle: ShaderStageHandle;
};
type GalleryState = {
  items: VisualSnapshot[];
  sections: GallerySection[];
};

const galleryApiPath = "/api/gallery";
const legacyGalleryStorageKey = "outcraft.gallery.v1";
const themeStorageKey = "outcraft.ui-theme.v1";
const defaultGallerySection: GallerySection = {
  id: "favorites",
  isOpen: true,
  name: "Favorites",
};

function App() {
  const stageRef = useRef<ShaderStageHandle | null>(null);
  const allStageRefs = useRef<Record<string, ShaderStageHandle | null>>({});
  const hasLoadedGalleryRef = useRef(false);
  const isSavingGalleryRef = useRef(false);
  const grainMixerRef = useRef(normalizeMesh(initialMesh).grainMixer);
  const pendingGalleryStateRef = useRef<GalleryState | null>(null);
  const skipNextGallerySaveRef = useRef(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("generate");
  const [activeGallerySectionId, setActiveGallerySectionId] = useState(
    defaultGallerySection.id,
  );
  const [uiTheme, setUiTheme] = useState<UiTheme>(readStoredTheme);
  const [backgroundColor, setBackgroundColor] = useState(initialBackgroundColor);
  const [activePaletteId, setActivePaletteId] = useState(paletteGroups[0].id);
  const [blobs, setBlobs] = useState(initialBlobs);
  const [galleryState, setGalleryState] =
    useState<GalleryState>(createDefaultGalleryState);
  const [gallerySaveStatus, setGallerySaveStatus] =
    useState<GallerySaveStatus>("loading");
  const [mesh, setMesh] = useState(() => normalizeMesh(initialMesh));
  const [format, setFormat] = useState<FormatOption>(formatOptions[0]);
  const [isPaused, setIsPaused] = useState(false);
  const [visualOverlay, setVisualOverlay] =
    useState<VisualOverlay>(defaultVisualOverlay);
  const [pausedFrame, setPausedFrame] = useState(
    () => normalizeMesh(initialMesh).frame,
  );
  const [frameOffset, setFrameOffset] = useState(0);
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [videoDuration, setVideoDuration] = useState<VideoDuration>(15);
  const [isVideoLoopEnabled, setIsVideoLoopEnabled] = useState(false);
  const [selectedVisualId, setSelectedVisualId] = useState<string | null>(null);

  const gallery = galleryState.items;
  const gallerySections = galleryState.sections;
  const isShowingAllFormats = isAllFormatsOption(format);
  const isShowingFullscreen = isFullscreenFormatOption(format);

  const flushGallerySaveQueue = async () => {
    if (isSavingGalleryRef.current) {
      return;
    }

    isSavingGalleryRef.current = true;

    try {
      while (pendingGalleryStateRef.current) {
        const nextGalleryState = pendingGalleryStateRef.current;
        pendingGalleryStateRef.current = null;
        await writeGalleryState(nextGalleryState);
      }

      setGallerySaveStatus("saved");
    } catch {
      setGallerySaveStatus("error");
    } finally {
      isSavingGalleryRef.current = false;

      if (pendingGalleryStateRef.current) {
        void flushGallerySaveQueue();
      }
    }
  };

  const queueGallerySave = (nextGalleryState: GalleryState) => {
    pendingGalleryStateRef.current = nextGalleryState;
    setGallerySaveStatus("saving");
    void flushGallerySaveQueue();
  };

  useEffect(() => {
    writeStoredTheme(uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    let isMounted = true;

    const loadGalleryState = async () => {
      try {
        const fileGalleryState = await readGalleryState();
        const legacyGalleryState = readLegacyGalleryState();
        const nextGalleryState = legacyGalleryState
          ? mergeGalleryStates(fileGalleryState, legacyGalleryState)
          : fileGalleryState;

        if (!isMounted) {
          return;
        }

        skipNextGallerySaveRef.current = legacyGalleryState === null;
        setGalleryState(nextGalleryState);
        hasLoadedGalleryRef.current = true;
        setGallerySaveStatus("saved");

        if (legacyGalleryState) {
          queueGallerySave(nextGalleryState);
        }
      } catch {
        const legacyGalleryState = readLegacyGalleryState();

        if (!isMounted) {
          return;
        }

        setGalleryState(legacyGalleryState ?? createDefaultGalleryState());
        hasLoadedGalleryRef.current = true;
        setGallerySaveStatus("error");
      }
    };

    void loadGalleryState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedGalleryRef.current) {
      return;
    }

    if (skipNextGallerySaveRef.current) {
      skipNextGallerySaveRef.current = false;
      return;
    }

    queueGallerySave(galleryState);
  }, [galleryState]);

  const updateBlob = (
    blobId: string,
    property: keyof BlobConfig,
    value: number | string,
  ) => {
    setBlobs((currentBlobs) =>
      currentBlobs.map((blob) =>
        blob.id === blobId ? { ...blob, [property]: value } : blob,
      ),
    );
  };

  const updateMesh = (property: keyof MeshConfig, value: number) => {
    if (property === "grainOverlay") {
      return;
    }

    if (property === "grainMixer") {
      grainMixerRef.current = value;
    }

    if (property === "frame") {
      const nextFrame = clampFrame(value);
      setPausedFrame(nextFrame);
      setFrameOffset(0);
      setMesh((currentMesh) => normalizeMesh({ ...currentMesh, frame: nextFrame }));
      return;
    }

    setMesh((currentMesh) => ({
      ...currentMesh,
      [property]: value,
      grainOverlay: fixedGrainOverlay,
    }));
  };

  const randomizeComposition = () => {
    const nextFrame = randomBetween(0, meshFrameMax);
    setPausedFrame(nextFrame);
    setFrameOffset(0);
    setMesh((currentMesh) => ({
      ...currentMesh,
      distortion: randomBetween(0.28, 0.86),
      frame: nextFrame,
      grainMixer: grainMixerRef.current,
      grainOverlay: fixedGrainOverlay,
      scale: randomBetween(0.9, 1.55),
      swirl: randomBetween(0.02, 0.34),
    }));
    setBlobs((currentBlobs) =>
      currentBlobs.map((blob, index) => ({
        ...createRandomBlob(index),
        color: blob.color,
        id: blob.id,
        name: blob.name,
      })),
    );
  };

  const randomizeColors = () => {
    setBackgroundColor(randomPaletteColor(activePaletteId));
    setBlobs((currentBlobs) =>
      currentBlobs.map((blob) => ({
        ...blob,
        color: randomPaletteColor(activePaletteId),
      })),
    );
  };

  const togglePlayback = () => {
    const currentMesh = normalizeMesh(stageRef.current?.getCurrentMesh() ?? mesh);

    setMesh(currentMesh);
    setPausedFrame(currentMesh.frame);
    setFrameOffset(0);
    setIsPaused((currentValue) => !currentValue);
  };

  const scrubFrame = (deltaFrames: number) => {
    if (!isPaused || deltaFrames === 0) {
      return;
    }

    setFrameOffset((currentOffset) => {
      const nextOffset = currentOffset + deltaFrames;

      setMesh((currentMesh) =>
        normalizeMesh({
          ...currentMesh,
          frame: pausedFrame + nextOffset,
        }),
      );

      return nextOffset;
    });
  };

  const captureCurrentVisual = () => {
    const thumbnail = stageRef.current?.captureThumbnail();

    if (!thumbnail) {
      return null;
    }

    return {
      backgroundColor,
      blobs: cloneBlobs(blobs),
      format: cloneFormat(format),
      mesh: normalizeMesh(stageRef.current?.getCurrentMesh() ?? mesh),
      overlay: { ...visualOverlay },
      thumbnail,
    };
  };

  const saveCurrentVisual = () => {
    const visual = captureCurrentVisual();

    if (!visual) {
      return;
    }

    const snapshot: VisualSnapshot = {
      ...visual,
      id: crypto.randomUUID(),
      name: generateVisualName(),
      sectionId: getExistingSectionId(gallerySections, activeGallerySectionId),
    };

    setGalleryState((currentState) => ({
      ...currentState,
      items: [snapshot, ...currentState.items],
      sections: currentState.sections.map((section) =>
        section.id === snapshot.sectionId ? { ...section, isOpen: true } : section,
      ),
    }));
    setSelectedVisualId(snapshot.id);
  };

  const getExportTargets = (): ExportTarget[] => {
    if (isShowingAllFormats) {
      return singleFormatOptions.flatMap((option) => {
        const handle = allStageRefs.current[option.label];

        return handle ? [{ format: option, handle }] : [];
      });
    }

    const exportFormat = isShowingFullscreen
      ? singleFormatOptions[0]
      : getSingleFormatOption(format.label);

    return stageRef.current
      ? [{ format: exportFormat, handle: stageRef.current }]
      : [];
  };

  const exportPng = async (scale: 1 | 2) => {
    const targets = getExportTargets();

    if (targets.length === 0) {
      return;
    }

    const baseName = slugify(generateVisualName());

    for (const target of targets) {
      const dataUrl = await captureTargetPng(target.handle, scale, visualOverlay);

      if (!dataUrl) {
        continue;
      }

      downloadDataUrl(
        dataUrl,
        `${baseName}-${formatSlug(target.format)}-${scale}x.png`,
      );
    }
  };

  const exportVideo = async (videoFormat: VideoExportFormat) => {
    const targets = getExportTargets();

    if (targets.length === 0 || typeof MediaRecorder === "undefined") {
      window.alert("Video export is not supported in this browser.");
      return;
    }

    const mimeType = getSupportedVideoMimeType(videoFormat);

    if (!mimeType) {
      window.alert(`${videoFormat.toUpperCase()} export is not supported in this browser.`);
      return;
    }

    const baseName = slugify(generateVisualName());

    setIsExportingVideo(true);

    try {
      for (const target of targets) {
        await exportVideoTarget(target, baseName, videoFormat, mimeType, {
          durationSeconds: videoDuration,
          isLoopable: isVideoLoopEnabled,
        });
      }
    } catch {
      window.alert("Video export failed.");
    } finally {
      setIsExportingVideo(false);
    }
  };

  const exportVideoTarget = async (
    target: ExportTarget,
    baseName: string,
    videoFormat: VideoExportFormat,
    mimeType: string,
    options: VideoExportOptions,
  ) => {
    const canvas = target.handle.getCanvas();

    if (!canvas) {
      throw new Error("Video export is not supported in this browser.");
    }

    const overlayImage = await loadOverlayImage(visualOverlay);
    const captureCanvas = document.createElement("canvas");
    captureCanvas.width = canvas.width;
    captureCanvas.height = canvas.height;

    const captureContext = captureCanvas.getContext("2d");

    if (!captureContext || typeof captureCanvas.captureStream !== "function") {
      throw new Error("Video export is not supported in this browser.");
    }

    const durationMs = options.durationSeconds * 1000;
    let loopStartCanvas: HTMLCanvasElement | null = null;

    const drawCompositedFrame = (context: CanvasRenderingContext2D) => {
      context.drawImage(canvas, 0, 0, context.canvas.width, context.canvas.height);
      drawOverlay(context, context.canvas.width, context.canvas.height, visualOverlay, overlayImage);
    };

    if (options.isLoopable) {
      loopStartCanvas = document.createElement("canvas");
      loopStartCanvas.width = captureCanvas.width;
      loopStartCanvas.height = captureCanvas.height;

      const loopStartContext = loopStartCanvas.getContext("2d");

      if (!loopStartContext) {
        throw new Error("Video export failed.");
      }

      drawCompositedFrame(loopStartContext);
    }

    const startedAt = performance.now();
    let drawFrameId = 0;
    const drawFrame = () => {
      drawCompositedFrame(captureContext);

      if (loopStartCanvas) {
        const loopFade = getLoopFadeAmount(performance.now() - startedAt, durationMs);

        if (loopFade > 0) {
          captureContext.save();
          captureContext.globalAlpha = loopFade;
          captureContext.drawImage(loopStartCanvas, 0, 0);
          captureContext.restore();
        }
      }

      drawFrameId = window.requestAnimationFrame(drawFrame);
    };

    drawFrame();

    const stream = captureCanvas.captureStream(60);
    const chunks: BlobPart[] = [];
    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 8000000,
      });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      window.cancelAnimationFrame(drawFrameId);
      throw error;
    }

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        recorder.onerror = () => {
          reject(new Error("Video export failed."));
        };
        recorder.onstop = () => {
          resolve(
            new Blob(chunks, {
              type: recorder.mimeType || mimeType,
            }),
          );
        };

        recorder.start();
        window.setTimeout(() => {
          if (recorder.state !== "inactive") {
            recorder.stop();
          }
        }, durationMs);
      });

      downloadBlob(
        blob,
        `${baseName}-${formatSlug(target.format)}-${options.durationSeconds}s${
          options.isLoopable ? "-loop" : ""
        }.${videoFormat}`,
      );
    } finally {
      window.cancelAnimationFrame(drawFrameId);
      stream.getTracks().forEach((track) => track.stop());
    }
  };

  const loadVisual = (visual: VisualSnapshot) => {
    const nextMesh = normalizeMesh(visual.mesh);

    setBackgroundColor(visual.backgroundColor);
    setBlobs(cloneBlobs(visual.blobs));
    grainMixerRef.current = nextMesh.grainMixer;
    setMesh(nextMesh);
    setVisualOverlay(normalizeOverlay(visual.overlay));
    setPausedFrame(nextMesh.frame);
    setFrameOffset(0);
    setFormat(getFormatOption(visual.format.label));
    setSelectedVisualId(visual.id);
  };

  const createGallerySection = (name: string) => {
    const trimmedName = name.trim();

    if (!trimmedName) {
      return;
    }

    const section: GallerySection = {
      id: crypto.randomUUID(),
      isOpen: true,
      name: trimmedName,
    };

    setGalleryState((currentState) => ({
      ...currentState,
      sections: [...currentState.sections, section],
    }));
    setActiveGallerySectionId(section.id);
  };

  const toggleGallerySection = (sectionId: string) => {
    setGalleryState((currentState) => ({
      ...currentState,
      sections: currentState.sections.map((section) =>
        section.id === sectionId
          ? { ...section, isOpen: !section.isOpen }
          : section,
      ),
    }));
  };

  const moveVisualToSection = (visualId: string, sectionId: string) => {
    setGalleryState((currentState) => {
      const targetSectionId = getExistingSectionId(
        currentState.sections,
        sectionId,
      );
      const movedItem = currentState.items.find((item) => item.id === visualId);

      if (!movedItem) {
        return currentState;
      }

      return {
        ...currentState,
        items: [
          { ...movedItem, sectionId: targetSectionId },
          ...currentState.items.filter((item) => item.id !== visualId),
        ],
        sections: currentState.sections.map((section) =>
          section.id === targetSectionId ? { ...section, isOpen: true } : section,
        ),
      };
    });
    setActiveGallerySectionId(sectionId);
  };

  return (
    <main className="app-shell" data-theme={uiTheme}>
      {isShowingFullscreen ? (
        <div className="fullscreen-visual" aria-hidden="true">
          <ShaderStage
            backgroundColor={backgroundColor}
            blobs={blobs}
            isPaused={isPaused}
            mesh={mesh}
          />
          <VisualOverlayMark overlay={visualOverlay} />
          <div className="fullscreen-export-frame">
            <ShaderStage
              ref={stageRef}
              backgroundColor={backgroundColor}
              blobs={blobs}
              isPaused={isPaused}
              mesh={mesh}
            />
          </div>
        </div>
      ) : null}

      <section
        className="control-panel relative z-10 flex flex-col gap-5 overflow-y-auto p-8"
        aria-label="Mesh controls"
      >
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-extrabold uppercase text-[var(--primary)]">
              Outcraft
            </p>
            <ThemeToggle value={uiTheme} onChange={setUiTheme} />
          </div>
          <h1 className="max-w-[8ch] text-5xl font-extrabold leading-[0.92] text-[var(--foreground)]">
            Mesh Lab
          </h1>
        </div>

        <Tabs value={activeTab} onChange={setActiveTab} />

        {activeTab === "generate" ? (
          <>
            <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2.5">
              <Button type="button" variant="outline" onClick={randomizeComposition}>
                <Shuffle className="size-4" aria-hidden="true" />
                Composition
              </Button>
              <Button type="button" variant="outline" onClick={randomizeColors}>
                <Palette className="size-4" aria-hidden="true" />
                Colors
              </Button>
              <Button
                aria-label="Save to gallery"
                type="button"
                variant="outline"
                size="icon"
                onClick={saveCurrentVisual}
              >
                <Heart className="size-4" aria-hidden="true" />
              </Button>
              <OverlayControl
                overlay={visualOverlay}
                onChange={setVisualOverlay}
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Button
                type="button"
                variant="secondary"
                onClick={togglePlayback}
              >
                {isPaused ? (
                  <Play className="size-4" aria-hidden="true" />
                ) : (
                  <Pause className="size-4" aria-hidden="true" />
                )}
                {isPaused ? "Play" : "Pause"}
              </Button>
              <ExportControl
                isExportingVideo={isExportingVideo}
                isExportingAllFormats={isShowingAllFormats}
                onExportPng={exportPng}
                onExportVideo={(videoFormat) => {
                  void exportVideo(videoFormat);
                }}
                videoDuration={videoDuration}
                isVideoLoopEnabled={isVideoLoopEnabled}
                onVideoDurationChange={setVideoDuration}
                onToggleVideoLoop={() =>
                  setIsVideoLoopEnabled((currentValue) => !currentValue)
                }
              />
            </div>

            <FrameScrubber
              disabled={!isPaused}
              offset={isPaused ? frameOffset : 0}
              onScrub={scrubFrame}
            />

            <FormatField value={format} onChange={setFormat} />

            <SwatchField
              activePaletteId={activePaletteId}
              label="Background"
              value={backgroundColor}
              onPaletteChange={setActivePaletteId}
              onChange={setBackgroundColor}
            />

            <section className="grid gap-4 border-t border-[var(--border)] pt-5">
              <h2 className="text-base font-bold text-[var(--foreground)]">Mesh</h2>

              <RangeControl
                label="Speed"
                max={1.8}
                min={0}
                step={0.01}
                value={mesh.speed}
                onChange={(value) => updateMesh("speed", value)}
              />
              <RangeControl
                label="Scale"
                max={1.8}
                min={0.55}
                step={0.01}
                value={mesh.scale}
                onChange={(value) => updateMesh("scale", value)}
              />
              <RangeControl
                label="Distortion"
                max={1.2}
                min={0}
                step={0.01}
                value={mesh.distortion}
                onChange={(value) => updateMesh("distortion", value)}
              />
              <RangeControl
                label="Swirl"
                max={0.6}
                min={0}
                step={0.01}
                value={mesh.swirl}
                onChange={(value) => updateMesh("swirl", value)}
              />
              <RangeControl
                label="Blur"
                max={1}
                min={0}
                step={0.01}
                value={mesh.motionBlur}
                onChange={(value) => updateMesh("motionBlur", value)}
              />
              <RangeControl
                label="Grain"
                max={0.2}
                min={0}
                step={0.001}
                value={mesh.grainMixer}
                onChange={(value) => updateMesh("grainMixer", value)}
              />
            </section>

            <div className="grid gap-5">
              {blobs.map((blob) => (
                <section
                  className="grid gap-4 border-t border-[var(--border)] pt-5"
                  key={blob.id}
                >
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="text-base font-bold text-[var(--foreground)]">
                      {blob.name}
                    </h2>
                    <span
                      className="size-6 rounded-full border border-[var(--border)]"
                      style={{ background: blob.color }}
                    />
                  </div>

                  <SwatchField
                    activePaletteId={activePaletteId}
                    label="Color"
                    value={blob.color}
                    onPaletteChange={setActivePaletteId}
                    onChange={(value) => updateBlob(blob.id, "color", value)}
                  />

                  <RangeControl
                    label="Opacity"
                    max={1}
                    min={0}
                    step={0.01}
                    value={blob.opacity}
                    onChange={(value) => updateBlob(blob.id, "opacity", value)}
                  />
                  <RangeControl
                    label="X"
                    max={1}
                    min={0}
                    step={0.01}
                    value={blob.x}
                    onChange={(value) => updateBlob(blob.id, "x", value)}
                  />
                  <RangeControl
                    label="Y"
                    max={1}
                    min={0}
                    step={0.01}
                    value={blob.y}
                    onChange={(value) => updateBlob(blob.id, "y", value)}
                  />
                  <RangeControl
                    label="Size"
                    max={2}
                    min={0.08}
                    step={0.01}
                    value={blob.size}
                    onChange={(value) => updateBlob(blob.id, "size", value)}
                  />
                  <RangeControl
                    label="Ellipse"
                    max={2.8}
                    min={0.35}
                    step={0.01}
                    value={blob.stretch}
                    onChange={(value) => updateBlob(blob.id, "stretch", value)}
                  />
                  <RangeControl
                    label="Bend"
                    max={1.2}
                    min={-1.2}
                    step={0.01}
                    value={blob.bend}
                    onChange={(value) => updateBlob(blob.id, "bend", value)}
                  />
                  <RangeControl
                    label="Taper"
                    max={0.95}
                    min={-0.95}
                    step={0.01}
                    value={blob.taper}
                    onChange={(value) => updateBlob(blob.id, "taper", value)}
                  />
                </section>
              ))}
            </div>
          </>
        ) : (
          <Gallery
            items={gallery}
            saveStatus={gallerySaveStatus}
            sections={gallerySections}
            selectedVisualId={selectedVisualId}
            onCreateSection={createGallerySection}
            onMoveVisual={moveVisualToSection}
            onSelect={loadVisual}
            onToggleSection={toggleGallerySection}
          />
        )}
      </section>

      <section className="preview-area" aria-label="Visual preview">
        {isShowingFullscreen ? null : isShowingAllFormats ? (
          <div className="format-overview" data-format-overview>
            {singleFormatOptions.map((option, index) => (
              <div className="format-overview-item" key={option.label}>
                <div
                  className="format-overview-frame"
                  data-overview-frame={option.label}
                  style={{
                    "--format-ratio": `${option.width / option.height}`,
                    aspectRatio: `${option.width} / ${option.height}`,
                  } as CSSProperties}
                >
                  <ShaderStage
                    ref={(handle) => {
                      allStageRefs.current[option.label] = handle;

                      if (index === 0) {
                        stageRef.current = handle;
                      }
                    }}
                    backgroundColor={backgroundColor}
                    blobs={blobs}
                    isPaused={isPaused}
                    mesh={mesh}
                  />
                  <VisualOverlayMark overlay={visualOverlay} />
                </div>
                <span>{option.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="format-frame"
            style={{
              "--format-ratio": `${format.width / format.height}`,
              aspectRatio: `${format.width} / ${format.height}`,
            } as CSSProperties}
          >
            <ShaderStage
              ref={stageRef}
              backgroundColor={backgroundColor}
              blobs={blobs}
              isPaused={isPaused}
              mesh={mesh}
            />
            <VisualOverlayMark overlay={visualOverlay} />
          </div>
        )}
      </section>
    </main>
  );
}

type RangeControlProps = {
  disabled?: boolean;
  formatValue?: (value: number, step: number) => string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
};

function RangeControl({
  disabled = false,
  formatValue = formatRangeValue,
  label,
  max,
  min,
  onChange,
  step,
  value,
}: RangeControlProps) {
  return (
    <label
      className={cn("grid gap-2.5", disabled && "opacity-55")}
      data-range-control={label}
    >
      <span className="flex items-center justify-between gap-4 text-sm font-semibold text-[var(--muted-foreground)]">
        <span>{label}</span>
        <strong className="text-xs text-[var(--primary)]">
          {formatValue(value, step)}
        </strong>
      </span>
      <Slider
        aria-label={label}
        disabled={disabled}
        max={max}
        min={min}
        step={step}
        value={[value]}
        onValueChange={([nextValue]) => onChange(nextValue)}
      />
    </label>
  );
}

function formatRangeValue(value: number, step: number) {
  if (step >= 1) {
    return Math.round(value).toString();
  }

  return value.toFixed(step < 0.01 ? 3 : 2);
}

type ExportControlProps = {
  isExportingAllFormats: boolean;
  isExportingVideo: boolean;
  isVideoLoopEnabled: boolean;
  onExportPng: (scale: 1 | 2) => void;
  onExportVideo: (format: VideoExportFormat) => void;
  onToggleVideoLoop: () => void;
  onVideoDurationChange: (duration: VideoDuration) => void;
  videoDuration: VideoDuration;
};

function ExportControl({
  isExportingAllFormats,
  isExportingVideo,
  isVideoLoopEnabled,
  onExportPng,
  onExportVideo,
  onToggleVideoLoop,
  onVideoDurationChange,
  videoDuration,
}: ExportControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const targetLabel = isExportingAllFormats ? "all formats" : "current format";

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnPointerDown = (event: globalThis.PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const runExport = (callback: () => void) => {
    callback();
    setIsOpen(false);
  };

  return (
    <div className="relative min-w-0" ref={menuRef}>
      <Button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`Export ${targetLabel}`}
        className="w-full min-w-0 px-3"
        disabled={isExportingVideo}
        type="button"
        variant="secondary"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        {isExportingVideo ? `Recording ${videoDuration}s` : "Export"}
      </Button>
      {isOpen ? (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-20 min-w-44 rounded-md border border-[var(--border)] bg-[var(--popover)] p-1 text-[var(--popover-foreground)] shadow-lg"
          role="menu"
        >
          <div className="px-3 py-1.5 text-xs font-bold uppercase text-[var(--muted-foreground)]">
            Image
          </div>
          <button
            className="flex min-h-9 w-full items-center rounded px-3 text-left text-sm font-semibold transition hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            onClick={() => runExport(() => onExportPng(1))}
            role="menuitem"
            type="button"
          >
            PNG 1x
          </button>
          <button
            className="flex min-h-9 w-full items-center rounded px-3 text-left text-sm font-semibold transition hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            onClick={() => runExport(() => onExportPng(2))}
            role="menuitem"
            type="button"
          >
            PNG 2x
          </button>
          <div className="my-1 h-px bg-[var(--border)]" role="separator" />
          <div className="px-3 py-1.5 text-xs font-bold uppercase text-[var(--muted-foreground)]">
            Video
          </div>
          <button
            className="flex min-h-9 w-full items-center rounded px-3 text-left text-sm font-semibold transition hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            onClick={() => runExport(() => onExportVideo("webm"))}
            role="menuitem"
            type="button"
          >
            WEBM
          </button>
          <button
            className="flex min-h-9 w-full items-center rounded px-3 text-left text-sm font-semibold transition hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            onClick={() => runExport(() => onExportVideo("mp4"))}
            role="menuitem"
            type="button"
          >
            MP4
          </button>
          <div className="my-1 h-px bg-[var(--border)]" role="separator" />
          <div className="px-3 py-1.5 text-xs font-bold uppercase text-[var(--muted-foreground)]">
            Video duration
          </div>
          {videoDurationOptions.map((duration) => (
            <button
              aria-checked={videoDuration === duration}
              className="flex min-h-9 w-full items-center justify-between gap-3 rounded px-3 text-left text-sm font-semibold transition hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              key={duration}
              onClick={() => onVideoDurationChange(duration)}
              role="menuitemcheckbox"
              type="button"
            >
              <span>{duration} seconds</span>
              {videoDuration === duration ? (
                <Check className="size-4" aria-hidden="true" />
              ) : null}
            </button>
          ))}
          <div className="my-1 h-px bg-[var(--border)]" role="separator" />
          <button
            aria-checked={isVideoLoopEnabled}
            className="flex min-h-9 w-full items-center justify-between gap-3 rounded px-3 text-left text-sm font-semibold transition hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            onClick={onToggleVideoLoop}
            role="menuitemcheckbox"
            type="button"
          >
            <span>Loopable video</span>
            {isVideoLoopEnabled ? (
              <Check className="size-4" aria-hidden="true" />
            ) : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

type OverlayControlProps = {
  onChange: (overlay: VisualOverlay) => void;
  overlay: VisualOverlay;
};

function OverlayControl({ onChange, overlay }: OverlayControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnPointerDown = (event: globalThis.PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const selectAsset = (asset: OverlayAsset) => {
    onChange({ ...overlay, asset });
  };

  const selectTone = (tone: OverlayTone) => {
    onChange({ ...overlay, tone });
  };

  return (
    <div className="relative" ref={menuRef}>
      <Button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Visual overlay"
        size="icon"
        type="button"
        variant="outline"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        <Shapes className="size-4" aria-hidden="true" />
      </Button>
      {isOpen ? (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-20 min-w-44 rounded-md border border-[var(--border)] bg-[var(--popover)] p-1 text-[var(--popover-foreground)] shadow-lg"
          role="menu"
        >
          <OverlayMenuItem
            isSelected={overlay.asset === "none"}
            label="None"
            onClick={() => selectAsset("none")}
          />
          <OverlayMenuItem
            isSelected={overlay.asset === "star"}
            label="Star"
            onClick={() => selectAsset("star")}
          />
          <OverlayMenuItem
            isSelected={overlay.asset === "logo"}
            label="Full Logo"
            onClick={() => selectAsset("logo")}
          />
          <div className="my-1 h-px bg-[var(--border)]" role="separator" />
          <OverlayMenuItem
            isSelected={overlay.tone === "light"}
            label="Light"
            onClick={() => selectTone("light")}
          />
          <OverlayMenuItem
            isSelected={overlay.tone === "dark"}
            label="Dark"
            onClick={() => selectTone("dark")}
          />
        </div>
      ) : null}
    </div>
  );
}

type OverlayMenuItemProps = {
  isSelected: boolean;
  label: string;
  onClick: () => void;
};

function OverlayMenuItem({ isSelected, label, onClick }: OverlayMenuItemProps) {
  return (
    <button
      className="flex min-h-9 w-full items-center justify-between gap-3 rounded px-3 text-left text-sm font-semibold transition hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span>{label}</span>
      {isSelected ? <Check className="size-4" aria-hidden="true" /> : null}
    </button>
  );
}

function VisualOverlayMark({ overlay }: { overlay: VisualOverlay }) {
  const overlaySource = getOverlayDataUrl(overlay);

  if (!overlaySource) {
    return null;
  }

  return (
    <img
      alt=""
      className={cn(
        "pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 select-none",
        overlay.asset === "star"
          ? "w-[22%] min-w-7 max-w-24"
          : "w-[62%] max-w-[320px]",
      )}
      src={overlaySource}
    />
  );
}

type FrameScrubberProps = {
  disabled: boolean;
  offset: number;
  onScrub: (deltaFrames: number) => void;
};

function FrameScrubber({ disabled, offset, onScrub }: FrameScrubberProps) {
  const isDraggingRef = useRef(false);
  const lastClientXRef = useRef(0);

  const applyPixelDelta = (pixelDelta: number) => {
    const frameDelta = Math.round(pixelDelta * frameScrubFramesPerPixel);

    if (frameDelta !== 0) {
      onScrub(frameDelta);
    }
  };

  const startScrub = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    isDraggingRef.current = true;
    lastClientXRef.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveScrub = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || disabled) {
      return;
    }

    const pixelDelta = event.clientX - lastClientXRef.current;
    lastClientXRef.current = event.clientX;
    applyPixelDelta(pixelDelta);
  };

  const stopScrub = (event: PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    const step = event.shiftKey ? 100 : 10;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onScrub(-step);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      onScrub(step);
    }
  };

  return (
    <div className={cn("grid gap-2.5", disabled && "opacity-55")}>
      <span className="flex items-center justify-between gap-4 text-sm font-semibold text-[var(--muted-foreground)]">
        <span>Frame</span>
        <strong className="text-xs text-[var(--primary)]">
          {formatSignedOffset(offset)}
        </strong>
      </span>
      <div
        aria-disabled={disabled}
        aria-label="Frame"
        className={cn(
          "relative h-12 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--background)]/44 touch-none select-none outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          disabled ? "cursor-not-allowed" : "cursor-ew-resize hover:bg-[var(--accent)]",
        )}
        data-frame-offset={offset}
        data-frame-scrubber
        onKeyDown={handleKeyDown}
        onPointerCancel={stopScrub}
        onPointerDown={startScrub}
        onPointerMove={moveScrub}
        onPointerUp={stopScrub}
        role="button"
        tabIndex={disabled ? -1 : 0}
      >
        <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--primary)]/70" />
        <div className="absolute inset-x-3 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--muted)]" />
        <div className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--primary)] bg-[var(--background)] shadow-sm" />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-[var(--background)]/90 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[var(--background)]/90 to-transparent" />
      </div>
    </div>
  );
}

function formatSignedOffset(value: number) {
  const roundedValue = Math.round(value);

  if (roundedValue > 0) {
    return `+${roundedValue}`;
  }

  return roundedValue.toString();
}

type SwatchFieldProps = {
  activePaletteId: string;
  label: string;
  onChange: (value: string) => void;
  onPaletteChange: (paletteId: string) => void;
  value: string;
};

type ThemeToggleProps = {
  onChange: (value: UiTheme) => void;
  value: UiTheme;
};

function ThemeToggle({ onChange, value }: ThemeToggleProps) {
  return (
    <div aria-label="Theme mode" className="flex shrink-0 items-center gap-1">
      {([
        { icon: Sun, label: "Light mode", value: "light" },
        { icon: Moon, label: "Dark mode", value: "dark" },
      ] as const).map((theme) => {
        const Icon = theme.icon;
        const isSelected = value === theme.value;

        return (
          <button
            aria-label={theme.label}
            aria-pressed={isSelected}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded text-[var(--muted-foreground)] opacity-35 transition hover:bg-[var(--accent)] hover:text-[var(--foreground)] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:opacity-100",
              isSelected && "text-[var(--foreground)] opacity-100",
            )}
            key={theme.value}
            onClick={() => onChange(theme.value)}
            type="button"
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

type FormatFieldProps = {
  onChange: (value: FormatOption) => void;
  value: FormatOption;
};

function FormatField({ onChange, value }: FormatFieldProps) {
  return (
    <div className="grid gap-2.5">
      <span className="text-sm font-semibold text-[var(--muted-foreground)]">
        Format
      </span>
      <div className="grid grid-cols-3 gap-2">
        {formatOptions.map((option) => (
          <Button
            className={cn(
              "h-auto min-h-12 flex-col gap-0.5 px-2 py-2",
              option.label === value.label &&
                "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/90",
            )}
            key={option.label}
            onClick={() => onChange(option)}
            type="button"
            variant="outline"
          >
            <span>{option.label}</span>
            <span className="text-[0.62rem] font-semibold opacity-70">
              {option.name}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}

type TabsProps = {
  onChange: (value: ActiveTab) => void;
  value: ActiveTab;
};

function Tabs({ onChange, value }: TabsProps) {
  return (
    <div
      className="grid grid-cols-2 rounded-md border border-[var(--border)] bg-[var(--background)]/38 p-1"
      role="tablist"
      aria-label="Generator sections"
    >
      <button
        className={cn(
          "min-h-9 rounded px-3 text-sm font-semibold text-[var(--muted-foreground)] transition",
          value === "generate" &&
            "bg-[var(--primary)] text-[var(--primary-foreground)]",
        )}
        type="button"
        role="tab"
        aria-selected={value === "generate"}
        onClick={() => onChange("generate")}
      >
        Generate
      </button>
      <button
        className={cn(
          "min-h-9 rounded px-3 text-sm font-semibold text-[var(--muted-foreground)] transition",
          value === "gallery" &&
            "bg-[var(--primary)] text-[var(--primary-foreground)]",
        )}
        type="button"
        role="tab"
        aria-selected={value === "gallery"}
        onClick={() => onChange("gallery")}
      >
        Gallery
      </button>
    </div>
  );
}

function gallerySaveStatusLabel(status: GallerySaveStatus) {
  if (status === "loading") {
    return "Loading file";
  }

  if (status === "saving") {
    return "Saving to file";
  }

  if (status === "error") {
    return "File save failed";
  }

  return "Saved to file";
}

type GalleryProps = {
  items: VisualSnapshot[];
  onCreateSection: (name: string) => void;
  onMoveVisual: (visualId: string, sectionId: string) => void;
  onSelect: (visual: VisualSnapshot) => void;
  onToggleSection: (sectionId: string) => void;
  saveStatus: GallerySaveStatus;
  sections: GallerySection[];
  selectedVisualId: string | null;
};

function Gallery({
  items,
  onCreateSection,
  onMoveVisual,
  onSelect,
  onToggleSection,
  saveStatus,
  sections,
  selectedVisualId,
}: GalleryProps) {
  const [newSectionName, setNewSectionName] = useState("");

  const handleCreateSection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = newSectionName.trim();

    if (!trimmedName) {
      return;
    }

    onCreateSection(trimmedName);
    setNewSectionName("");
  };

  return (
    <section className="grid gap-4">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-base font-bold text-[var(--foreground)]">Gallery</h2>
        <div className="grid justify-items-end gap-1">
          <span className="text-xs font-semibold text-[var(--muted-foreground)]">
            {items.length} saved
          </span>
          <span
            className={cn(
              "text-[0.64rem] font-bold uppercase",
              saveStatus === "error"
                ? "text-[var(--destructive)]"
                : "text-[var(--muted-foreground)]",
            )}
            data-gallery-save-status={saveStatus}
          >
            {gallerySaveStatusLabel(saveStatus)}
          </span>
        </div>
      </div>

      <form className="grid grid-cols-[1fr_auto] gap-2" onSubmit={handleCreateSection}>
        <input
          aria-label="Section name"
          className="h-10 min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)]/52 px-3 text-sm font-semibold text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          onChange={(event) => setNewSectionName(event.target.value)}
          placeholder="Section name"
          value={newSectionName}
        />
        <Button type="submit" variant="outline">
          Create section
        </Button>
      </form>

      <div className="grid gap-3">
        {sections.map((section) => {
          const sectionItems = items.filter((item) => item.sectionId === section.id);

          return (
            <section
              className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--background)]/24"
              data-gallery-section={section.name}
              data-section-id={section.id}
              key={section.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const visualId = event.dataTransfer.getData("text/plain");

                if (visualId) {
                  onMoveVisual(visualId, section.id);
                }
              }}
            >
              <button
                aria-expanded={section.isOpen}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm font-bold text-[var(--foreground)] transition hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-inset"
                onClick={() => onToggleSection(section.id)}
                type="button"
              >
                <span className="truncate">{section.name}</span>
                <span className="shrink-0 text-xs font-semibold text-[var(--muted-foreground)]">
                  {sectionItems.length}
                </span>
              </button>

              {section.isOpen ? (
                <div className="grid gap-3 border-t border-[var(--border)] p-3">
                  {sectionItems.length === 0 ? (
                    <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm font-semibold text-[var(--muted-foreground)]">
                      Drop visuals here.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {sectionItems.map((item) => (
                        <button
                          className={cn(
                            "grid min-w-0 gap-1 rounded-md border border-[var(--border)] bg-[var(--background)]/36 p-1.5 text-left transition hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
                            item.id === selectedVisualId &&
                              "border-[var(--primary)] ring-2 ring-[var(--primary)]/80",
                          )}
                          data-gallery-item
                          data-visual-id={item.id}
                          draggable
                          key={item.id}
                          onClick={() => onSelect(item)}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", item.id);
                          }}
                          type="button"
                        >
                          <img
                            alt=""
                            className="aspect-square w-full rounded border border-[var(--border)] object-cover"
                            draggable={false}
                            src={item.thumbnail}
                          />
                          <span className="truncate text-[0.68rem] font-bold text-[var(--foreground)]">
                            {item.name}
                          </span>
                          <span className="text-[0.62rem] font-semibold text-[var(--muted-foreground)]">
                            {item.format.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function SwatchField({
  activePaletteId,
  label,
  onChange,
  onPaletteChange,
  value,
}: SwatchFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activePalette = getPaletteGroup(activePaletteId);
  const selectedColor = findPaletteColor(value);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnPointerDown = (event: globalThis.PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const selectColor = (colorValue: string) => {
    onChange(colorValue);
    setIsOpen(false);
  };

  return (
    <div className="relative grid gap-2.5" ref={menuRef}>
      <span className="text-sm font-semibold text-[var(--muted-foreground)]">
        {label}
      </span>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex h-10 w-full items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-left text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        data-swatch-trigger={label}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="size-5 shrink-0 rounded border border-[var(--border)]"
            style={{ background: value }}
          />
          <span className="truncate">{selectedColor?.name ?? value}</span>
        </span>
        <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
          {activePalette.name}
        </span>
      </button>
      {isOpen ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 rounded-md border border-[var(--border)] bg-[var(--popover)] p-2 text-[var(--popover-foreground)] shadow-lg"
          role="menu"
        >
          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-1">
              {paletteGroups.map((palette) => (
                <button
                  className={cn(
                    "min-h-8 rounded px-2 text-sm font-semibold transition hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                    palette.id === activePalette.id &&
                      "bg-[var(--primary)] text-[var(--primary-foreground)]",
                  )}
                  key={palette.id}
                  onClick={() => onPaletteChange(palette.id)}
                  type="button"
                >
                  {palette.name}
                </button>
              ))}
            </div>
            <div className="h-px bg-[var(--border)]" />
            <div className="grid grid-cols-6 gap-2">
              {activePalette.colors.map((color) => (
                <button
                  aria-label={color.name}
                  className={cn(
                    "h-9 rounded-md border border-[var(--border)] shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
                    color.value.toLowerCase() === value.toLowerCase() &&
                      "border-[var(--foreground)] ring-2 ring-[var(--primary)]",
                  )}
                  key={color.value}
                  onClick={() => selectColor(color.value)}
                  role="menuitem"
                  style={{ background: color.value }}
                  title={color.name}
                  type="button"
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function createRandomBlob(index: number): BlobConfig {
  return {
    bend: randomBetween(-1.05, 1.05),
    color: randomPaletteColor(),
    id: `blob-${index}`,
    name: `Anchor ${index + 1}`,
    opacity: randomBetween(0.56, 1),
    rotation: randomBetween(-Math.PI, Math.PI),
    size: randomBetween(0.18, 0.5),
    stretch: randomBetween(0.62, 2.2),
    taper: randomBetween(-0.82, 0.82),
    x: randomBetween(0.14, 0.86),
    y: randomBetween(0.14, 0.86),
  };
}

function getPaletteGroup(paletteId: string) {
  return (
    paletteGroups.find((palette) => palette.id === paletteId) ??
    paletteGroups[0]
  );
}

function findPaletteColor(value: string) {
  const normalizedValue = value.toLowerCase();

  return paletteGroups
    .flatMap((palette) => palette.colors)
    .find((color) => color.value.toLowerCase() === normalizedValue);
}

function randomPaletteColor(paletteId = paletteGroups[0].id) {
  const colors = getPaletteGroup(paletteId).colors;

  return colors[Math.floor(Math.random() * colors.length)].value;
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clampFrame(frame: number) {
  return Math.min(meshFrameMax, Math.max(0, frame));
}

function getLoopFadeAmount(elapsedMs: number, durationMs: number) {
  const fadeDurationMs = Math.min(3000, durationMs * 0.25);
  const holdDurationMs = Math.min(250, durationMs * 0.05);
  const fadeEndMs = durationMs - holdDurationMs;
  const fadeStartMs = fadeEndMs - fadeDurationMs;
  const progress = Math.min(
    1,
    Math.max(0, (elapsedMs - fadeStartMs) / fadeDurationMs),
  );

  return progress * progress * (3 - 2 * progress);
}

function normalizeMesh(meshToNormalize: MeshConfig): MeshConfig {
  return {
    distortion: finiteNumber(meshToNormalize.distortion, initialMesh.distortion),
    frame: Number.isFinite(meshToNormalize.frame) ? meshToNormalize.frame : 0,
    grainMixer: Number.isFinite(meshToNormalize.grainMixer)
      ? meshToNormalize.grainMixer
      : fixedGrainMixer,
    grainOverlay: fixedGrainOverlay,
    motionBlur: finiteNumber(meshToNormalize.motionBlur, 0),
    scale: finiteNumber(meshToNormalize.scale, initialMesh.scale),
    speed: finiteNumber(meshToNormalize.speed, initialMesh.speed),
    swirl: finiteNumber(meshToNormalize.swirl, initialMesh.swirl),
  };
}

function normalizeBlob(blobToNormalize: BlobConfig, index: number): BlobConfig {
  const fallback = initialBlobs[index] ?? initialBlobs[0];

  return {
    bend: finiteNumber(blobToNormalize.bend, fallback.bend),
    color: typeof blobToNormalize.color === "string"
      ? blobToNormalize.color
      : fallback.color,
    id: typeof blobToNormalize.id === "string" && blobToNormalize.id
      ? blobToNormalize.id
      : fallback.id,
    name: typeof blobToNormalize.name === "string" && blobToNormalize.name
      ? blobToNormalize.name
      : fallback.name,
    opacity: finiteNumber(blobToNormalize.opacity, fallback.opacity),
    rotation: finiteNumber(blobToNormalize.rotation, fallback.rotation),
    size: finiteNumber(blobToNormalize.size, fallback.size),
    stretch: finiteNumber(blobToNormalize.stretch, fallback.stretch),
    taper: finiteNumber(blobToNormalize.taper, fallback.taper),
    x: finiteNumber(blobToNormalize.x, fallback.x),
    y: finiteNumber(blobToNormalize.y, fallback.y),
  };
}

function cloneBlobs(blobsToClone: BlobConfig[]) {
  return blobsToClone.map((blob, index) => normalizeBlob(blob, index));
}

function cloneFormat(formatToClone: FormatConfig): FormatConfig {
  return { ...formatToClone };
}

function getFormatOption(label: string) {
  return (
    formatOptions.find((option) => option.label === label) ?? formatOptions[0]
  );
}

function getSingleFormatOption(label: string) {
  return (
    singleFormatOptions.find((option) => option.label === label) ??
    singleFormatOptions[0]
  );
}

function isAllFormatsOption(formatToCheck: FormatConfig) {
  return formatToCheck.label === allFormatsOption.label;
}

function isFullscreenFormatOption(formatToCheck: FormatConfig) {
  return formatToCheck.label === fullscreenFormatOption.label;
}

function formatSlug(formatToSlug: FormatConfig) {
  return formatToSlug.label.replace(":", "x").toLowerCase();
}

async function captureTargetPng(
  handle: ShaderStageHandle,
  scale: 1 | 2,
  overlay: VisualOverlay,
) {
  const canvas = handle.getCanvas();

  if (!canvas) {
    return null;
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
  drawOverlay(
    context,
    exportCanvas.width,
    exportCanvas.height,
    overlay,
    await loadOverlayImage(overlay),
  );

  return exportCanvas.toDataURL("image/png");
}

async function loadOverlayImage(overlay: VisualOverlay) {
  const overlaySource = getOverlayDataUrl(overlay);

  if (!overlaySource) {
    return null;
  }

  const image = new Image();
  image.decoding = "async";
  image.src = overlaySource;
  await image.decode();

  return image;
}

function drawOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay: VisualOverlay,
  image: HTMLImageElement | null,
) {
  if (!image || overlay.asset === "none") {
    return;
  }

  const imageRatio = image.naturalWidth / image.naturalHeight;
  const maxWidth = overlay.asset === "star" ? width * 0.22 : width * 0.62;
  const maxHeight = overlay.asset === "star" ? height * 0.22 : height * 0.22;
  let drawWidth = maxWidth;
  let drawHeight = drawWidth / imageRatio;

  if (drawHeight > maxHeight) {
    drawHeight = maxHeight;
    drawWidth = drawHeight * imageRatio;
  }

  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function getOverlayDataUrl(overlay: VisualOverlay) {
  const svg = getOverlaySvg(overlay);

  if (!svg) {
    return null;
  }

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getOverlaySvg(overlay: VisualOverlay) {
  const color = overlay.tone === "light" ? "#ffffff" : "#000000";

  if (overlay.asset === "star") {
    return `<svg width="456" height="457" viewBox="0 0 456 457" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M455.486 211.779V244.402V254.743C366.911 263.445 260.644 231.797 219.298 148.054C207.811 168.151 197.604 182.394 185.036 194.53C171.948 207.174 156.779 217.047 135.285 228.441C156.658 239.797 171.828 249.67 184.876 262.236C198.044 274.957 208.611 290.02 220.899 311.795C233.547 288.537 245.955 269.65 271.211 250.138C285.7 258.88 306.593 269.338 333.69 277.533L324.724 282.567C299.348 296.81 281.897 318.312 270.33 343.13C255.721 374.466 250.357 411.109 250.037 445.566L249.917 456.961H238.27H203.848H192.441L192.121 445.722C190.36 382.349 176.551 336.458 147.693 306.137C118.995 275.894 74.4868 260.284 11.2471 257.162L0 256.616V245.729V245.651V211.349V211.232V200.345L11.2471 199.798C76.6482 196.599 121.116 180.17 149.294 149.615C177.632 118.864 190.4 73.0123 192.121 11.2387L192.441 0H203.848H238.27H249.917L250.037 11.3948C251.198 140.327 326.365 213.808 455.486 198.901V211.818V211.779Z" fill="${color}"/></svg>`;
  }

  if (overlay.asset === "logo") {
    return `<svg width="1447" height="266" viewBox="0 0 1447 266" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M556.717 129.646C556.717 197.115 509.824 242.834 440.622 242.834C371.42 242.834 324.527 197.138 324.527 129.646C324.527 62.1536 371.42 16.4573 440.645 16.4573C509.87 16.4573 556.74 62.1762 556.74 129.646H556.717ZM361.531 129.646C361.531 181.272 394.379 211.419 440.622 211.419C486.865 211.419 520.038 181.249 520.038 129.646C520.038 78.042 487.19 47.5552 440.622 47.5552C394.054 47.5552 361.531 78.0194 361.531 129.646Z" fill="${color}"/><path d="M697.378 82.7037H730.877V238.171H697.378V219.204C685.585 233.508 668.035 242.833 643.8 242.833C600.11 242.833 572.996 212.052 572.996 170.701V82.7037H606.494V171.312C606.494 196.82 619.889 213.297 646.678 213.297C676.021 213.297 697.402 193.719 697.402 160.449V82.7037H697.378Z" fill="${color}"/><path d="M817.271 213.906V243.442C778.363 245.615 753.176 228.527 753.176 187.788V20.5061H786.674V82.7019H817.294V112.238H786.674V189.032C786.674 212.05 800.695 213.906 817.294 213.906H817.271Z" fill="${color}"/><path d="M961.115 177.832H994.289C989.506 217.326 955.706 242.811 911.367 242.811C860.969 242.811 826.844 209.541 826.844 160.404C826.844 111.268 860.969 77.9968 911.367 77.9968C955.381 77.9968 989.181 103.188 994.289 142.365H960.79C955.056 120.276 936.23 107.533 911.367 107.533C880.422 107.533 858.74 127.133 858.74 160.404C858.74 193.675 880.422 213.252 911.367 213.252C936.555 213.252 955.381 200.51 961.115 177.809V177.832Z" fill="${color}"/><path d="M1013.41 238.173V82.7064H1046.91V94.204C1060.31 79.583 1079.76 73.9926 1104.65 80.2167L1098.91 108.191C1062.56 102.284 1046.94 122.812 1046.94 160.429V238.173H1013.44H1013.41Z" fill="${color}"/><path d="M1235.38 220.744C1223.27 234.12 1205.09 242.811 1180.53 242.811C1132.36 242.811 1098.23 209.541 1098.23 160.404C1098.23 111.268 1132.36 77.9968 1180.53 77.9968C1205.09 77.9968 1223.27 86.7106 1235.38 100.064V82.6593H1268.88V238.126H1235.38V220.721V220.744ZM1182.76 213.298C1214 213.298 1235.38 193.72 1235.38 160.449C1235.38 127.179 1214.03 107.578 1182.76 107.578C1151.49 107.578 1130.13 127.179 1130.13 160.449C1130.13 193.72 1151.81 213.298 1182.76 213.298Z" fill="${color}"/><path d="M1344.77 46.3104C1335.53 46.3104 1324.69 50.0448 1324.69 67.7666V86.7331H1355.31V116.269H1324.69V238.149H1291.19V68.0834C1291.19 39.792 1308.42 16.4573 1339.66 16.4573C1346.05 16.4573 1359.44 17.3852 1371.24 22.9983L1358.79 48.4832C1353.69 46.9215 1348.58 46.3104 1344.77 46.3104Z" fill="${color}"/><path d="M1446.52 213.906V243.442C1407.61 245.615 1382.42 228.527 1382.42 187.788V20.5061H1415.92V82.7019H1446.54V112.238H1415.92V189.032C1415.92 212.05 1429.94 213.906 1446.54 213.906H1446.52Z" fill="${color}"/><path d="M264.179 122.83V141.751V147.749C212.805 152.796 151.171 134.441 127.191 85.8701C120.529 97.5262 114.609 105.787 107.32 112.826C99.7286 120.159 90.9304 125.885 78.4643 132.494C90.8608 139.081 99.659 144.807 107.227 152.095C114.864 159.473 120.993 168.209 128.12 180.839C135.455 167.349 142.652 156.395 157.3 145.078C165.704 150.148 177.822 156.214 193.538 160.967L188.338 163.887C173.62 172.148 163.498 184.618 156.789 199.013C148.316 217.188 145.205 238.44 145.02 258.425L144.95 265.034H138.195H118.23H111.614L111.429 258.516C110.407 221.759 102.398 195.143 85.6608 177.557C69.0161 160.016 43.2018 150.963 6.52322 149.152L0 148.835V142.521V142.476V122.581V122.513V116.198L6.52322 115.882C44.4554 114.026 70.2465 104.497 86.5893 86.7754C103.025 68.9405 110.43 42.3466 111.429 6.51834L111.614 0H118.23H138.195H144.95L145.02 6.60887C145.693 81.3887 189.289 124.007 264.179 115.361V122.853V122.83Z" fill="${color}"/></svg>`;
  }

  return null;
}

function generateVisualName() {
  const modifiers = [
    "Velvet",
    "Nocturne",
    "Signal",
    "Ghost",
    "Orbit",
    "Static",
    "Halo",
    "Drift",
  ];
  const nouns = [
    "Mesh",
    "Bloom",
    "Field",
    "Pulse",
    "Trace",
    "Echo",
    "Gradient",
    "Frame",
  ];
  const modifier = modifiers[Math.floor(Math.random() * modifiers.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const suffix = Math.floor(100 + Math.random() * 900);

  return `${modifier} ${noun} ${suffix}`;
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");

  link.download = filename;
  link.href = dataUrl;
  link.click();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.download = filename;
  link.href = url;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getSupportedVideoMimeType(videoFormat: VideoExportFormat) {
  const mimeTypes =
    videoFormat === "mp4"
      ? ["video/mp4;codecs=h264", "video/mp4;codecs=avc1.42E01E", "video/mp4"]
      : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function readGalleryState(): Promise<GalleryState> {
  const response = await fetch(galleryApiPath, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Gallery file could not be loaded.");
  }

  return normalizeGalleryState(await response.json());
}

async function writeGalleryState(state: GalleryState): Promise<void> {
  const response = await fetch(galleryApiPath, {
    body: JSON.stringify(state),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error("Gallery file could not be saved.");
  }
}

function readLegacyGalleryState(): GalleryState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedState = window.localStorage.getItem(legacyGalleryStorageKey);

    if (!storedState) {
      return null;
    }

    const galleryState = normalizeGalleryState(JSON.parse(storedState));

    return hasGalleryContent(galleryState) ? galleryState : null;
  } catch {
    return null;
  }
}

function mergeGalleryStates(
  fileGalleryState: GalleryState,
  legacyGalleryState: GalleryState,
): GalleryState {
  const sections = [...fileGalleryState.sections];
  const sectionIds = new Set(sections.map((section) => section.id));

  legacyGalleryState.sections.forEach((section) => {
    if (!sectionIds.has(section.id)) {
      sections.push(section);
      sectionIds.add(section.id);
    }
  });

  const visualIds = new Set(fileGalleryState.items.map((item) => item.id));
  const items = [
    ...fileGalleryState.items,
    ...legacyGalleryState.items.filter((item) => {
      if (visualIds.has(item.id)) {
        return false;
      }

      visualIds.add(item.id);
      return true;
    }),
  ];

  return normalizeGalleryState({ items, sections });
}

function hasGalleryContent(state: GalleryState) {
  return (
    state.items.length > 0 ||
    state.sections.some((section) => section.id !== defaultGallerySection.id)
  );
}

function readStoredTheme(): UiTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  try {
    return window.localStorage.getItem(themeStorageKey) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

function writeStoredTheme(theme: UiTheme) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // Theme persistence is optional; the UI still works if storage is blocked.
  }
}

function normalizeGalleryState(value: unknown): GalleryState {
  const rawItems = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.items)
      ? value.items
      : [];
  const rawSections =
    isRecord(value) && Array.isArray(value.sections) ? value.sections : [];
  const normalizedSections = rawSections
    .map(normalizeGallerySection)
    .filter((section): section is GallerySection => section !== null);
  const sections =
    normalizedSections.length > 0
      ? ensureDefaultSection(normalizedSections)
      : [{ ...defaultGallerySection }];
  const sectionIds = new Set(sections.map((section) => section.id));
  const fallbackSectionId = sections[0]?.id ?? defaultGallerySection.id;
  const items = rawItems
    .map((item) => normalizeGalleryItem(item, sectionIds, fallbackSectionId))
    .filter((item): item is VisualSnapshot => item !== null);

  return { items, sections };
}

function createDefaultGalleryState(): GalleryState {
  return {
    items: [],
    sections: [{ ...defaultGallerySection }],
  };
}

function normalizeGallerySection(value: unknown): GallerySection | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" && value.id ? value.id : "";
  const name = typeof value.name === "string" && value.name.trim()
    ? value.name.trim()
    : "";

  if (!id || !name) {
    return null;
  }

  return {
    id,
    isOpen: typeof value.isOpen === "boolean" ? value.isOpen : true,
    name,
  };
}

function normalizeGalleryItem(
  value: unknown,
  sectionIds: Set<string>,
  fallbackSectionId: string,
): VisualSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const sectionId =
    typeof value.sectionId === "string" && sectionIds.has(value.sectionId)
      ? value.sectionId
      : fallbackSectionId;

  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.thumbnail !== "string" ||
    typeof value.backgroundColor !== "string" ||
    !Array.isArray(value.blobs) ||
    !isRecord(value.format) ||
    !isRecord(value.mesh)
  ) {
    return null;
  }

  return {
    backgroundColor: value.backgroundColor,
    blobs: (value.blobs as BlobConfig[]).map((blob, index) =>
      normalizeBlob(blob, index),
    ),
    format: value.format as FormatConfig,
    id: value.id,
    mesh: normalizeMesh(value.mesh as MeshConfig),
    name: value.name,
    overlay: normalizeOverlay(value.overlay),
    sectionId,
    thumbnail: value.thumbnail,
  };
}

function normalizeOverlay(value: unknown): VisualOverlay {
  if (!isRecord(value)) {
    return { ...defaultVisualOverlay };
  }

  const asset =
    value.asset === "star" || value.asset === "logo" || value.asset === "none"
      ? value.asset
      : defaultVisualOverlay.asset;
  const tone =
    value.tone === "light" || value.tone === "dark"
      ? value.tone
      : defaultVisualOverlay.tone;

  return { asset, tone };
}

function ensureDefaultSection(sections: GallerySection[]) {
  if (sections.some((section) => section.id === defaultGallerySection.id)) {
    return sections;
  }

  return [{ ...defaultGallerySection }, ...sections];
}

function getExistingSectionId(sections: GallerySection[], sectionId: string) {
  return (
    sections.find((section) => section.id === sectionId)?.id ??
    sections[0]?.id ??
    defaultGallerySection.id
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export default App;
