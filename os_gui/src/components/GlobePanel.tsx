import { memo, useEffect, useRef } from 'react';
import {
  Viewer,
  Ion,
  Cartesian3,
  Cartesian2,
  Color,
  Entity as CesiumEntity,
  ImageryLayer,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  Math as CesiumMath,
  EllipsoidTerrainProvider,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  buildModuleUrl,
  NearFarScalar,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useOsStore } from '../store';

const selectSpatialTraits = (s: ReturnType<typeof useOsStore.getState>) => s.spatialTraits;
const selectSelectedId = (s: ReturnType<typeof useOsStore.getState>) => s.selectedEntityId;
const selectSelectEntity = (s: ReturnType<typeof useOsStore.getState>) => s.selectEntity;
const selectEntities = (s: ReturnType<typeof useOsStore.getState>) => s.entities;

export const GlobePanel = memo(function GlobePanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);

  const spatialTraits = useOsStore(selectSpatialTraits);
  const selectedId = useOsStore(selectSelectedId);
  const selectEntity = useOsStore(selectSelectEntity);
  const entities = useOsStore(selectEntities);

  // --- Bootstrap Cesium viewer once ---
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;
    const el = containerRef.current;

    // No Ion account needed — all imagery is self-contained or free
    Ion.defaultAccessToken = undefined as any;

    // Hidden credit container inside our element
    const creditDiv = document.createElement('div');
    creditDiv.style.cssText = 'position:absolute;bottom:0;left:0;width:0;height:0;overflow:hidden;pointer-events:none;';
    el.appendChild(creditDiv);

    let viewer: Viewer;
    try {
      // Use Cesium's bundled Natural Earth II texture as the base — guaranteed to load instantly
      viewer = new Viewer(el, {
        baseLayer: ImageryLayer.fromProviderAsync(
          TileMapServiceImageryProvider.fromUrl(
            buildModuleUrl('Assets/Textures/NaturalEarthII')
          )
        ),
        terrainProvider: new EllipsoidTerrainProvider(),
        creditContainer: creditDiv,
        // UI widgets
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        navigationInstructionsInitiallyVisible: false,
      });
    } catch (err) {
      console.error('Cesium Viewer failed to initialize:', err);
      return;
    }

    // --- Visual enhancements ---
    const scene = viewer.scene;
    const globe = scene.globe;

    // Render at native device resolution (sharper on HiDPI / Retina)
    viewer.useBrowserRecommendedResolution = false;
    viewer.resolutionScale = window.devicePixelRatio || 1.0;

    // Dark space background
    scene.backgroundColor = Color.fromCssColorString('#05050a');

    // Globe rendering — crisper tiles
    globe.show = true;
    globe.enableLighting = true;
    globe.showGroundAtmosphere = true;
    globe.maximumScreenSpaceError = 1.5; // lower = sharper tiles

    // Atmosphere glow
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.show = true;
      scene.skyAtmosphere.brightnessShift = 0.1;
    }

    // Add high-res satellite tile layer on top of NaturalEarthII
    // Using UrlTemplateImageryProvider directly bypasses the `MapServer?f=json` metadata fetch,
    // which can silently fail in Tauri Webviews due to missing user-agents or CORS strictness.
    try {
      const arcgisProvider = new UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: 'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      });
      viewer.imageryLayers.add(new ImageryLayer(arcgisProvider));
    } catch (err) {
      console.error('Failed to overlay ArcGIS tiles:', err);
    }

    viewerRef.current = viewer;

    // --- Click handler ---
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: any) => {
      const picked = viewer.scene.pick(movement.position);
      if (defined(picked) && defined(picked.id) && picked.id instanceof CesiumEntity) {
        if (picked.id.id) selectEntity(picked.id.id);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
    handlerRef.current = handler;

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.resize();
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      handler.destroy();
      handlerRef.current = null;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, [selectEntity]);

  // --- Update entity markers ---
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.entities.removeAll();

    for (const trait of spatialTraits) {
      const isSelected = trait.owner === selectedId;
      const entity = entities.find(e => e.id === trait.owner);
      const label = entity?.label ?? trait.owner;

      viewer.entities.add({
        id: trait.owner,
        name: label,
        position: Cartesian3.fromDegrees(trait.lng, trait.lat, (trait.alt ?? 0) + 100),
        point: {
          pixelSize: isSelected ? 16 : 10,
          color: isSelected ? Color.WHITE : Color.fromCssColorString('#5b8af0'),
          outlineColor: Color.fromCssColorString('#0a0a0d'),
          outlineWidth: 2,
          scaleByDistance: new NearFarScalar(1e3, 1.5, 1e7, 0.5),
        },
        label: {
          text: label,
          font: '13px "JetBrains Mono", monospace',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: 2, // FILL_AND_OUTLINE
          pixelOffset: new Cartesian2(0, -22),
          scaleByDistance: new NearFarScalar(1e3, 1.0, 5e6, 0.3),
          show: true,
        },
      });
    }

    // Fly to selected entity
    if (selectedId) {
      const target = spatialTraits.find(t => t.owner === selectedId);
      if (target) {
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(target.lng, target.lat, 2_000_000),
          duration: 1.5,
          orientation: {
            heading: CesiumMath.toRadians(0),
            pitch: CesiumMath.toRadians(-45),
            roll: 0,
          },
        });
      }
    }

    viewer.scene.requestRender();
  }, [spatialTraits, selectedId, entities]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />
    </div>
  );
});
