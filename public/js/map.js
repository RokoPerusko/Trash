// Cesium preglednik: teren, zgrade, podloge i pomocne funkcije za pozicije na karti.
const Cesium = window.Cesium;

export const toDeg = (rad) => Cesium.Math.toDegrees(rad);

// boja iz CSS varijable teme (da SVG i Cesium prate svijetlu/tamnu temu)
export const themeVar = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
export const themeColor = (name, fallback) =>
  Cesium.Color.fromCssColorString(themeVar(name, fallback));

const BASES = {
  sat: {
    label: 'Satelit',
    ion: true,
    make: () =>
      Cesium.ImageryLayer.fromWorldImagery({
        style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS,
      }),
  },
  roads: {
    label: 'Ceste',
    ion: true,
    make: () =>
      Cesium.ImageryLayer.fromWorldImagery({
        style: Cesium.IonWorldImageryStyle.ROAD,
      }),
  },
  osm: {
    label: 'OpenStreetMap',
    ion: false,
    make: () =>
      new Cesium.ImageryLayer(
        new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }),
      ),
  },
};

export async function createMap(cfg) {
  const hasToken = !!cfg.ionToken;
  if (hasToken) Cesium.Ion.defaultAccessToken = cfg.ionToken;

  const options = {
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    fullscreenButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    baseLayerPicker: false,
    infoBox: false,
    selectionIndicator: false,
    baseLayer: BASES[hasToken ? 'sat' : 'osm'].make(),
  };
  if (hasToken) options.terrain = Cesium.Terrain.fromWorldTerrain();
  const viewer = new Cesium.Viewer('cesium', options);
  viewer.scene.globe.depthTestAgainstTerrain = true;
  if (hasToken) {
    try {
      viewer.scene.primitives.add(await Cesium.createOsmBuildingsAsync());
    } catch (e) {
      console.warn('OSM zgrade nisu ucitane:', e);
    }
  }

  function setBase(key) {
    const base = BASES[key];
    if (!base || (base.ion && !hasToken)) return false;
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.add(base.make());
    return true;
  }

  // tocka na tlu ispod pokazivaca (s terenom i zgradama ako postoje)
  function pickGround(position) {
    if (hasToken) {
      const c = viewer.scene.pickPosition(position);
      if (c) return c;
    }
    return viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
  }

  // sinkrono: samo iz vec ucitanih dijelova terena (blizu kamere); inace 0
  function sampleGroundHeight(carto) {
    if (hasToken && viewer.scene.sampleHeightSupported) {
      try {
        const h = viewer.scene.sampleHeight(carto);
        if (Number.isFinite(h)) return h;
      } catch {
        /* izvan ucitanog terena */
      }
    }
    return 0;
  }

  // asinkrono: dohvaca teren najvece razlucivosti gdje god bila kamera. Vraca niz visina
  // (m) ili null ako teren nije dostupan (nema tokena ili greska).
  async function sampleTerrain(cartographics) {
    const provider = viewer.terrainProvider;
    if (!hasToken || !provider || provider instanceof Cesium.EllipsoidTerrainProvider) return null;
    try {
      const copies = cartographics.map((c) => new Cesium.Cartographic(c.longitude, c.latitude));
      const sampled = await Cesium.sampleTerrainMostDetailed(provider, copies);
      return sampled.map((c) => (Number.isFinite(c.height) ? c.height : 0));
    } catch (e) {
      console.warn('Uzorkovanje terena nije uspjelo:', e);
      return null;
    }
  }

  return {
    Cesium,
    viewer,
    hasToken,
    bases: Object.entries(BASES)
      .filter(([, b]) => hasToken || !b.ion)
      .map(([key, b]) => ({ key, label: b.label })),
    setBase,
    pickGround,
    sampleGroundHeight,
    sampleTerrain,
  };
}
