// Mjerenje: udaljenost po tlu i zrakom, visinski profil i linija vidljivosti preko terena
// izmedju dvije tocke na karti.
import { $, el, clear } from './util.js';
import { themeColor } from './map.js';
import { formatDistance } from './geo.js';
import { buildProfileSvg } from './profile.js';

const SAMPLES = 48;
const EYE_HEIGHT_M = 1.6;

export function createMeasure(app) {
  const { Cesium, viewer, pickGround } = app.map;
  const layer = [];
  let points = [];
  let finished = false;

  function reset() {
    for (const e of layer) viewer.entities.remove(e);
    layer.length = 0;
    points = [];
    $('measurePanel').hidden = true;
  }

  function render({ groundDist, slant, visible, obstrDist, samples }) {
    const body = clear($('mBody'));
    const dl = el(
      'dl',
      {},
      el('dt', { text: 'Udaljenost (po tlu)' }),
      el('dd', { text: formatDistance(groundDist) }),
      el('dt', { text: 'Udaljenost (zrakom)' }),
      el('dd', { text: formatDistance(slant) }),
    );
    const chip = el(
      'span',
      { class: `pill ${visible ? 'ok' : 'bad'}`, style: 'margin-top:8px' },
      el('i'),
      el('span', {
        text: visible
          ? 'Vidljivo (nema prepreka)'
          : `Nema vidljivosti (prepreka na ${formatDistance(obstrDist)})`,
      }),
    );
    body.append(
      dl,
      chip,
      buildProfileSvg(samples, { visible }),
      el('div', {
        class: 'cap',
        text: 'Sivo = teren, zeleno/crveno = linija vidljivosti (oko 1,6 m iznad tla).',
      }),
    );
  }

  async function compute() {
    const [a, b] = points;
    const geodesic = new Cesium.EllipsoidGeodesic(a, b);
    const groundDist = geodesic.surfaceDistance;
    const cartos = [];
    for (let i = 0; i <= SAMPLES; i++) {
      cartos.push(geodesic.interpolateUsingFraction(i / SAMPLES, new Cesium.Cartographic()));
    }
    const heights =
      (await app.map.sampleTerrain(cartos)) || cartos.map((c) => app.map.sampleGroundHeight(c));
    const samples = cartos.map((carto, i) => ({
      dist: (groundDist * i) / SAMPLES,
      h: heights[i],
      carto,
    }));
    const h0 = samples[0].h + EYE_HEIGHT_M;
    const h1 = samples[SAMPLES].h + EYE_HEIGHT_M;
    samples.forEach((s, i) => {
      s.line = h0 + ((h1 - h0) * i) / SAMPLES;
    });
    const obstrIdx = samples.findIndex((s, i) => i > 0 && i < SAMPLES && s.h > s.line);
    const visible = obstrIdx === -1;
    if (!visible) samples[obstrIdx].obstructed = true;

    const posA = Cesium.Cartesian3.fromRadians(a.longitude, a.latitude, h0);
    const posB = Cesium.Cartesian3.fromRadians(b.longitude, b.latitude, h1);
    layer.push(
      viewer.entities.add({
        polyline: {
          positions: [posA, posB],
          width: 3,
          material: themeColor(visible ? '--ok' : '--danger', visible ? '#3fcf8e' : '#e5484d'),
        },
      }),
    );
    if (!visible) {
      const oc = samples[obstrIdx].carto;
      layer.push(
        viewer.entities.add({
          position: Cesium.Cartesian3.fromRadians(oc.longitude, oc.latitude, samples[obstrIdx].h),
          point: {
            pixelSize: 10,
            color: themeColor('--danger', '#e5484d'),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    }
    $('measurePanel').hidden = false;
    render({
      groundDist,
      slant: Cesium.Cartesian3.distance(posA, posB),
      visible,
      obstrDist: visible ? null : samples[obstrIdx].dist,
      samples,
    });
  }

  app.modes.register('measure', {
    button: $('toolMeasure'),
    enter() {
      reset();
      finished = false;
      app.modes.hint('Klikni dvije točke na karti za mjerenje.', [
        { label: 'Odustani', onClick: () => app.modes.set(null) },
      ]);
    },
    exit() {
      if (!finished) reset();
    },
    click(pos) {
      if (viewer.scene.pick(pos)) return;
      const cartesian = pickGround(pos);
      if (!cartesian) return;
      points.push(Cesium.Cartographic.fromCartesian(cartesian));
      layer.push(
        viewer.entities.add({
          position: cartesian,
          point: {
            pixelSize: 8,
            color: Cesium.Color.WHITE,
            outlineColor: themeColor('--accent', '#5aa0ff'),
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
      if (points.length === 2) {
        finished = true;
        app.modes.set(null);
        compute();
      } else {
        app.modes.hint('Klikni drugu točku.', [
          { label: 'Odustani', onClick: () => app.modes.set(null) },
        ]);
      }
    },
  });

  $('mClose').addEventListener('click', () => {
    finished = false;
    reset();
  });

  return { reset };
}
