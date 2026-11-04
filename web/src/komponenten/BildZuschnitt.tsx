import { useEffect, useRef, useState } from "react";
import { Symbol } from "./Symbol";
import { t } from "../i18n";

/** Punkt in Anteilen (0–1) des Bildes */
type Punkt = { x: number; y: number };
/** Vier freie Ecken: oben links, oben rechts, unten rechts, unten links */
type Viereck = [Punkt, Punkt, Punkt, Punkt];
/** Ecke 0–3, Kante zwischen zwei Ecken ("k01" = oben, "k12" = rechts, "k23" = unten, "k30" = links) oder ganzer Rahmen */
type Griff = 0 | 1 | 2 | 3 | "k01" | "k12" | "k23" | "k30" | "mitte";

const VOLL: Viereck = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const KANTEN: Record<"k01" | "k12" | "k23" | "k30", [number, number]> = { k01: [0, 1], k12: [1, 2], k23: [2, 3], k30: [3, 0] };
const istVoll = (v: Viereck) => v.every((p, i) => p.x === VOLL[i].x && p.y === VOLL[i].y);

/** Bilder, die der Browser selbst darstellen kann (HEIC meist nicht, PDF nie) */
export const zuschneidbar = (datei: File) => /^image\/(jpeg|png|webp|gif|bmp)$/.test(datei.type);

// Objekt-URLs der geladenen Bilder; werden beim Schließen des Editors freigegeben
const urls = new Set<string>();

async function bildLaden(quelle: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(quelle);
  urls.add(url);
  const bild = new Image();
  bild.src = url;
  await bild.decode();
  return bild;
}

function urlsFreigeben() {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
}

/** Bild um 90° (im Uhrzeigersinn) drehen */
async function drehen(bild: HTMLImageElement): Promise<HTMLImageElement> {
  const leinwand = document.createElement("canvas");
  leinwand.width = bild.naturalHeight;
  leinwand.height = bild.naturalWidth;
  const ctx = leinwand.getContext("2d")!;
  ctx.translate(leinwand.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(bild, 0, 0);
  const blob = await new Promise<Blob>((ok) => leinwand.toBlob((b) => ok(b!), "image/jpeg", 0.95));
  return bildLaden(blob);
}

/**
 * Projektive Abbildung Einheitsquadrat -> Viereck (nach Heckbert):
 * (u, v) ∈ [0,1]² mit (0,0)=oben links, (1,0)=oben rechts, (1,1)=unten rechts, (0,1)=unten links.
 */
function quadratAufViereck([p0, p1, p2, p3]: Punkt[]) {
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, c = p0.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y, f = p0.y;
  return (u: number, v: number) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w] as const;
  };
}

const abstand = (a: Punkt, b: Punkt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Viereck aus dem Bild herauslösen und zu einem geraden Rechteck entzerren */
async function entzerren(bild: HTMLImageElement, viereck: Viereck, name: string, filter: Filter): Promise<File> {
  const W = bild.naturalWidth, H = bild.naturalHeight;
  const px = viereck.map((p) => ({ x: p.x * W, y: p.y * H }));
  // Zielgröße: längere der gegenüberliegenden Kanten, höchstens 3000 px
  let breite = Math.max(abstand(px[0], px[1]), abstand(px[3], px[2]));
  let hoehe = Math.max(abstand(px[0], px[3]), abstand(px[1], px[2]));
  const faktor = Math.min(1, 3000 / Math.max(breite, hoehe));
  breite = Math.max(1, Math.round(breite * faktor));
  hoehe = Math.max(1, Math.round(hoehe * faktor));

  const quelle = document.createElement("canvas");
  quelle.width = W;
  quelle.height = H;
  const qctx = quelle.getContext("2d", { willReadFrequently: true })!;
  qctx.drawImage(bild, 0, 0);
  const q = qctx.getImageData(0, 0, W, H).data;

  const ziel = document.createElement("canvas");
  ziel.width = breite;
  ziel.height = hoehe;
  const zctx = ziel.getContext("2d")!;
  const aus = zctx.createImageData(breite, hoehe);
  const z = aus.data;
  const abbilden = quadratAufViereck(px);

  // Jeden Zielpunkt im Quellbild nachschlagen (bilinear interpoliert, damit Schrift scharf bleibt)
  for (let yz = 0; yz < hoehe; yz++) {
    const v = (yz + 0.5) / hoehe;
    for (let xz = 0; xz < breite; xz++) {
      const [sx, sy] = abbilden((xz + 0.5) / breite, v);
      const x0 = Math.min(W - 2, Math.max(0, Math.floor(sx - 0.5)));
      const y0 = Math.min(H - 2, Math.max(0, Math.floor(sy - 0.5)));
      const fx = Math.min(1, Math.max(0, sx - 0.5 - x0));
      const fy = Math.min(1, Math.max(0, sy - 0.5 - y0));
      const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
      const o = (yz * breite + xz) * 4;
      for (let k = 0; k < 3; k++) {
        const oben = q[i00 + k] + (q[i10 + k] - q[i00 + k]) * fx;
        const unten = q[i01 + k] + (q[i11 + k] - q[i01 + k]) * fx;
        z[o + k] = oben + (unten - oben) * fy;
      }
      z[o + 3] = 255;
    }
  }
  filterAnwenden(aus, filter);
  zctx.putImageData(aus, 0, 0);
  const blob = await new Promise<Blob>((ok) => ziel.toBlob((b) => ok(b!), "image/jpeg", 0.92));
  return new File([blob], name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
}

/**
 * Mehrere Fotos eines langen Bons untereinander zu einem Bild zusammensetzen.
 * Alle Teile werden auf dieselbe Breite gebracht (höchstens 1600 px, damit die Schrift lesbar bleibt);
 * doppelt fotografierte Zeilen an den Nahtstellen erkennt die KI.
 */
export async function bilderZusammenfuegen(dateien: File[]): Promise<File> {
  const bilder = await Promise.all(dateien.map((d) => bildLaden(d)));
  try {
    let breite = Math.min(1600, ...bilder.map((b) => b.naturalWidth));
    const hoeheBei = (w: number) => bilder.reduce((s, b) => s + Math.round((b.naturalHeight * w) / b.naturalWidth), 0);
    // Browser-Grenze für Leinwände (iOS: ~16.000 px Kantenlänge) nicht überschreiten
    if (hoeheBei(breite) > 16000) breite = Math.floor((breite * 16000) / hoeheBei(breite));
    const leinwand = document.createElement("canvas");
    leinwand.width = breite;
    leinwand.height = hoeheBei(breite);
    const ctx = leinwand.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, leinwand.width, leinwand.height);
    let y = 0;
    for (const b of bilder) {
      const h = Math.round((b.naturalHeight * breite) / b.naturalWidth);
      ctx.drawImage(b, 0, y, breite, h);
      y += h;
    }
    const blob = await new Promise<Blob>((ok) => leinwand.toBlob((b) => ok(b!), "image/jpeg", 0.9));
    const name = dateien[0].name.replace(/\.[^.]+$/, "") + `-${dateien.length}teilig.jpg`;
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    urlsFreigeben();
  }
}

const begrenzen = (wert: number, min: number, max: number) => Math.min(max, Math.max(min, wert));

// ---------- Automatische Bon-Erkennung (ohne KI) ----------

type P = { x: number; y: number };
const kreuz = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const flaecheVon = (pkt: P[]) => Math.abs(pkt.reduce((s, p, i) => s + p.x * pkt[(i + 1) % pkt.length].y - pkt[(i + 1) % pkt.length].x * p.y, 0)) / 2;

/** Konvexe Hülle (Monotone Chain) */
function huelle(punkte: P[]): P[] {
  const p = [...punkte].sort((a, b) => a.x - b.x || a.y - b.y);
  const unten: P[] = [];
  for (const q of p) {
    while (unten.length >= 2 && kreuz(unten[unten.length - 2], unten[unten.length - 1], q) <= 0) unten.pop();
    unten.push(q);
  }
  const oben: P[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    while (oben.length >= 2 && kreuz(oben[oben.length - 2], oben[oben.length - 1], p[i]) <= 0) oben.pop();
    oben.push(p[i]);
  }
  return [...unten.slice(0, -1), ...oben.slice(0, -1)];
}

/** Hülle auf vier Ecken eindampfen: immer die Ecke entfernen, die am wenigsten Fläche kostet */
function aufVierEcken(h: P[]): P[] | null {
  const p = [...h];
  while (p.length > 4) {
    let beste = 0;
    let kleinste = Infinity;
    for (let i = 0; i < p.length; i++) {
      const f = Math.abs(kreuz(p[(i - 1 + p.length) % p.length], p[i], p[(i + 1) % p.length]));
      if (f < kleinste) (kleinste = f), (beste = i);
    }
    p.splice(beste, 1);
  }
  return p.length === 4 ? p : null;
}

/**
 * Sucht einen hellen Bon auf dunklerem Untergrund. Liefert nur dann ein Viereck,
 * wenn der Kontrast eindeutig ist und die gefundene Fläche wirklich viereckig ist – sonst null.
 */
export function bonErkennen(bild: HTMLImageElement): Viereck | null {
  const faktor = Math.min(1, 360 / Math.max(bild.naturalWidth, bild.naturalHeight));
  const w = Math.max(8, Math.round(bild.naturalWidth * faktor));
  const h = Math.max(8, Math.round(bild.naturalHeight * faktor));
  const leinwand = document.createElement("canvas");
  leinwand.width = w;
  leinwand.height = h;
  const ctx = leinwand.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bild, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;

  // „Papier-Weiß“: hell UND farblos. Holztische, Hände oder Kartons sind oft hell, aber farbig –
  // die Sättigung abzuziehen trennt den Bon deutlich besser vom Untergrund. Leicht geglättet (3×3) gegen die Schrift.
  const roh = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    roh[i] = Math.max(0, 0.299 * r + 0.587 * g + 0.114 * b - 1.2 * (Math.max(r, g, b) - Math.min(r, g, b)));
  }
  const hell = new Uint8Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0, z = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) (s += roh[yy * w + xx]), z++;
        }
      hell[y * w + x] = s / z;
    }

  // Schwelle nach Otsu
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < n; i++) hist[hell[i]]++;
  let summe = 0;
  for (let i = 0; i < 256; i++) summe += i * hist[i];
  let sB = 0, wB = 0, besteVar = 0, otsu = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB || wB === n) continue;
    sB += t * hist[t];
    const mB = sB / wB, mF = (summe - sB) / (n - wB);
    const v = wB * (n - wB) * (mB - mF) ** 2;
    if (v > besteVar) (besteVar = v), (otsu = t);
  }
  // Perzentil-Schwellen: der Bon ist meist das Hellste im Bild, auch wenn Otsu am hellen Tisch scheitert
  const perzentil = (anteil: number) => {
    let s = 0;
    for (let t = 0; t < 256; t++) if ((s += hist[t]) >= n * anteil) return t;
    return 255;
  };
  const schwellen = [...new Set([otsu - 15, otsu, otsu + 20, otsu + 40, perzentil(0.5), perzentil(0.7), perzentil(0.85)])].filter((t) => t > 30 && t < 250);

  // Mehrere Schwellen probieren. Gewertet wird vor allem der Randkontrast: Höhere Schwellen zerfallen an Falz-
  // und Knitterschatten in Teilstücke, niedrigere nehmen Tisch mit – beides hat einen schwächeren Rand als der ganze Bon.
  const kandidaten = schwellen.map((s) => vierEckBei(hell, w, h, s)).filter((k): k is Kandidat => k != null);
  if (!kandidaten.length) return null;
  const groesste = Math.max(...kandidaten.map((k) => k.flaeche));
  const wert = (k: Kandidat) => k.randKontrast * k.passung * Math.pow(k.flaeche / groesste, 0.6);
  const beste = kandidaten.reduce((a, b) => (wert(b) > wert(a) ? b : a));
  // Reihenfolge: oben links zuerst, dann im Uhrzeigersinn; minimal nach außen erweitern
  const ecken = beste.ecken;
  const mx = ecken.reduce((s, p) => s + p.x, 0) / 4, my = ecken.reduce((s, p) => s + p.y, 0) / 4;
  const sortiert = [...ecken].sort((a, b) => Math.atan2(a.y - my, a.x - mx) - Math.atan2(b.y - my, b.x - mx));
  const start = sortiert.reduce((bester, p, i) => (p.x + p.y < sortiert[bester].x + sortiert[bester].y ? i : bester), 0);
  const reihe = [0, 1, 2, 3].map((k) => sortiert[(start + k) % 4]);
  return reihe.map((p) => ({
    x: begrenzen((mx + (p.x - mx) * 1.015) / w, 0, 1),
    y: begrenzen((my + (p.y - my) * 1.015) / h, 0, 1),
  })) as Viereck;
}

/** Maske mit 3×3-Quadrat verkleinern (abtragen) bzw. vergrößern */
function morph(maske: Uint8Array, w: number, h: number, wachsen: boolean): Uint8Array {
  const aus = new Uint8Array(maske.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let wert = wachsen ? 0 : 1;
      for (let dy = -1; dy <= 1 && wert === (wachsen ? 0 : 1); dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          const m = xx >= 0 && yy >= 0 && xx < w && yy < h ? maske[yy * w + xx] : 0;
          if (wachsen ? m : !m) {
            wert = wachsen ? 1 : 0;
            break;
          }
        }
      aus[y * w + x] = wert;
    }
  return aus;
}

/** Größte helle Fläche bei einer Schwelle; nur zurückgeben, wenn sie deutlich heller als die Umgebung und viereckig ist */
type Kandidat = { ecken: P[]; flaeche: number; passung: number; randKontrast: number };

function vierEckBei(hell: Uint8Array, w: number, h: number, schwelle: number): Kandidat | null {
  const n = w * h;
  let maske: Uint8Array = new Uint8Array(n);
  let sHell = 0, nHell = 0, sDunkel = 0;
  for (let i = 0; i < n; i++) {
    if (hell[i] > schwelle) (maske[i] = 1), (sHell += hell[i]), nHell++;
    else sDunkel += hell[i];
  }
  if (!nHell || nHell === n) return null;
  // Papier muss klar heller sein als der Untergrund
  if (sHell / nHell - sDunkel / (n - nHell) < 18) return null;
  // Schließen (wachsen, abtragen): füllt Schrift und Knitterschatten im Papier, damit der Bon eine Fläche bleibt
  // (2 Schritte, damit auch Falzlinien quer über den Bon überbrückt werden)
  maske = morph(morph(maske, w, h, true), w, h, true);
  maske = morph(morph(maske, w, h, false), w, h, false);
  // Öffnen (2× abtragen, 2× wachsen): trennt Finger, Kabel und Lichtreflexe, die am Bon hängen
  maske = morph(morph(maske, w, h, false), w, h, false);
  maske = morph(morph(maske, w, h, true), w, h, true);

  // größte zusammenhängende helle Fläche
  const marke = new Int32Array(n).fill(-1);
  const stapel = new Int32Array(n);
  let groesste = -1, groesse = 0;
  for (let start = 0, nr = 0; start < n; start++) {
    if (!maske[start] || marke[start] !== -1) continue;
    let oben = 0, anzahl = 0;
    stapel[oben++] = start;
    marke[start] = nr;
    while (oben) {
      const i = stapel[--oben];
      anzahl++;
      const x = i % w;
      for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1])
        if (j >= 0 && j < n && marke[j] === -1 && maske[j]) (marke[j] = nr), (stapel[oben++] = j);
    }
    if (anzahl > groesse) (groesse = anzahl), (groesste = nr);
    nr++;
  }
  if (groesse < n * 0.02) return null;

  // Löcher (Schrift) füllen: alles, was vom Rand aus nicht über Untergrund erreichbar ist, gehört zum Bon
  const aussen = new Uint8Array(n);
  let oben = 0;
  const rein = (i: number) => {
    if (!aussen[i] && marke[i] !== groesste) (aussen[i] = 1), (stapel[oben++] = i);
  };
  for (let x = 0; x < w; x++) rein(x), rein((h - 1) * w + x);
  for (let y = 0; y < h; y++) rein(y * w), rein(y * w + w - 1);
  while (oben) {
    const i = stapel[--oben];
    const x = i % w;
    if (i >= w) rein(i - w);
    if (i < n - w) rein(i + w);
    if (x > 0) rein(i - 1);
    if (x < w - 1) rein(i + 1);
  }
  let gefuellt = 0;
  const rand: P[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (aussen[i]) continue;
      gefuellt++;
      // nur Randpunkte für die Hülle
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || aussen[i - 1] || aussen[i + 1] || aussen[i - w] || aussen[i + w]) rand.push({ x: x + 0.5, y: y + 0.5 });
    }
  if (gefuellt > n * 0.97) return null; // Bon füllt schon das ganze Bild

  const ecken = aufVierEcken(huelle(rand));
  if (!ecken) return null;
  // muss ein Viereck sein: gefüllte Fläche deckt das Viereck weitgehend (geknickte Bons dürfen etwas abweichen)
  const vier = flaecheVon(ecken);
  if (gefuellt / vier < 0.82 || vier / gefuellt > 1.22) return null;

  // Randkontrast: Helligkeit knapp innerhalb minus knapp außerhalb der Fläche. Beim ganzen Bon liegt rundum
  // Untergrund, bei einem Teilstück (an einem Falz abgeschnitten) liegt an einer Seite noch Papier.
  let innen: Uint8Array = new Uint8Array(n);
  for (let i = 0; i < n; i++) innen[i] = aussen[i] ? 0 : 1;
  let weit: Uint8Array = innen, eng: Uint8Array = innen;
  for (let k = 0; k < 3; k++) (weit = morph(weit, w, h, true)), (eng = morph(eng, w, h, false));
  let sInnen = 0, nInnen = 0, sAussen = 0, nAussen = 0;
  for (let i = 0; i < n; i++) {
    if (innen[i] && !eng[i]) (sInnen += hell[i]), nInnen++;
    else if (weit[i] && !innen[i]) (sAussen += hell[i]), nAussen++;
  }
  innen = new Uint8Array(0);
  const randKontrast = nInnen && nAussen ? sInnen / nInnen - sAussen / nAussen : 0;
  if (randKontrast < 12) return null;
  return { ecken, flaeche: gefuellt, passung: Math.min(gefuellt / vier, vier / gefuellt), randKontrast };
}

// ---------- Filter ----------

export type Filter = "original" | "grau" | "kontrast" | "sw";
const FILTER: { wert: Filter; text: string }[] = [
  { wert: "original", text: t("Original") },
  { wert: "grau", text: t("Graustufen") },
  { wert: "kontrast", text: t("Kontrast") },
  { wert: "sw", text: t("Schwarz/Weiß") },
];
const FILTER_SPEICHER = "tillsplit:filter";

/** Verkleinerte, gefilterte Vorschau; die volle Auflösung wird erst beim Übernehmen gefiltert (nur der Bon) */
// verkleinerte Bildpunkte je Foto merken – das Verkleinern ist der teuerste Schritt
const verkleinert = new WeakMap<HTMLImageElement, ImageData>();

async function gefiltert(bild: HTMLImageElement, filter: Filter): Promise<HTMLImageElement> {
  if (filter === "original") return bild;
  let basis = verkleinert.get(bild);
  if (!basis) {
    const faktor = Math.min(1, 1400 / Math.max(bild.naturalWidth, bild.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(bild.naturalWidth * faktor);
    c.height = Math.round(bild.naturalHeight * faktor);
    const cx = c.getContext("2d", { willReadFrequently: true })!;
    cx.drawImage(bild, 0, 0, c.width, c.height);
    basis = cx.getImageData(0, 0, c.width, c.height);
    verkleinert.set(bild, basis);
  }
  const leinwand = document.createElement("canvas");
  leinwand.width = basis.width;
  leinwand.height = basis.height;
  const ctx = leinwand.getContext("2d")!;
  const daten = new ImageData(new Uint8ClampedArray(basis.data), basis.width, basis.height);
  filterAnwenden(daten, filter);
  ctx.putImageData(daten, 0, 0);
  const blob = await new Promise<Blob>((ok) => leinwand.toBlob((b) => ok(b!), "image/jpeg", 0.92));
  return bildLaden(blob);
}

/** Filter auf Bildpunkte anwenden (Ergebnis in Graustufen) */
function filterAnwenden(bild: ImageData, filter: Filter) {
  if (filter === "original") return;
  const { width: w, height: h, data: d } = bild;
  const n = w * h;
  const l = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) l[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];

  if (filter === "kontrast") {
    // Tonwerte spreizen: 1 % dunkelste -> schwarz, 1 % hellste -> weiß, Mitten leicht abdunkeln (Schrift kräftiger)
    const hist = new Array<number>(256).fill(0);
    for (let i = 0; i < n; i++) hist[l[i]]++;
    let lo = 0, hi = 255, s = 0;
    while (lo < 255 && (s += hist[lo]) < n * 0.01) lo++;
    s = 0;
    while (hi > 0 && (s += hist[hi]) < n * 0.01) hi--;
    const spanne = Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) l[i] = 255 * Math.pow(begrenzen((l[i] - lo) / spanne, 0, 1), 1.4);
  } else if (filter === "sw") {
    // adaptive Schwelle (Bradley): jeder Punkt wird mit der Helligkeit seiner Umgebung verglichen -> Schatten stören nicht
    const integral = new Uint32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let zeile = 0;
      for (let x = 0; x < w; x++) {
        zeile += l[y * w + x];
        integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + zeile;
      }
    }
    const r = Math.max(4, Math.round(Math.max(w, h) / 50));
    const aus = new Uint8ClampedArray(n);
    for (let y = 0; y < h; y++) {
      const y1 = Math.max(0, y - r), y2 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x1 = Math.max(0, x - r), x2 = Math.min(w, x + r + 1);
        const summe = integral[y2 * (w + 1) + x2] - integral[y1 * (w + 1) + x2] - integral[y2 * (w + 1) + x1] + integral[y1 * (w + 1) + x1];
        aus[y * w + x] = l[y * w + x] * (x2 - x1) * (y2 - y1) < summe * 0.85 ? 0 : 255;
      }
    }
    l.set(aus);
  }
  for (let i = 0; i < n; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = l[i];
}

/** Punkt, an dem ein Griff sitzt (Ecke oder Kantenmitte) */
function griffPunkt(v: Viereck, g: Exclude<Griff, "mitte">): Punkt {
  if (typeof g === "number") return v[g];
  const [a, b] = KANTEN[g];
  return { x: (v[a].x + v[b].x) / 2, y: (v[a].y + v[b].y) / 2 };
}

const LUPE = 132; // Durchmesser in px
const ZOOM = 3;
const ABSTAND = 40; // Abstand zwischen Finger und Lupe

/**
 * Vergrößerte Ansicht des gezogenen Punkts, schräg neben dem Finger (nicht darunter).
 * Standard oben links vom Finger; am Bildschirmrand wird auf die andere Seite gewechselt.
 */
function Lupe({ bild, viereck, punkt, fingerX, fingerY, anzeigeB, anzeigeH }: {
  bild: HTMLImageElement; viereck: Viereck; punkt: Punkt; fingerX: number; fingerY: number; anzeigeB: number; anzeigeH: number;
}) {
  const links = fingerX - ABSTAND - LUPE >= 8 ? fingerX - ABSTAND - LUPE : fingerX + ABSTAND;
  const oben = fingerY - ABSTAND - LUPE >= 8 ? fingerY - ABSTAND - LUPE : Math.min(window.innerHeight - LUPE - 8, fingerY + ABSTAND);
  const b = anzeigeB * ZOOM;
  const h = anzeigeH * ZOOM;
  // Rahmen in Lupen-Koordinaten (gezogener Punkt in der Mitte)
  const linie = viereck.map((p) => `${LUPE / 2 + (p.x - punkt.x) * b},${LUPE / 2 + (p.y - punkt.y) * h}`).join(" ");
  return (
    <div
      className="pointer-events-none fixed z-[70] overflow-hidden rounded-full border-[3px] border-white bg-black shadow-2xl"
      style={{
        left: links,
        top: oben,
        width: LUPE,
        height: LUPE,
        backgroundImage: `url(${bild.src})`,
        backgroundSize: `${b}px ${h}px`,
        backgroundPosition: `${LUPE / 2 - punkt.x * b}px ${LUPE / 2 - punkt.y * h}px`,
        backgroundRepeat: "no-repeat",
      }}
    >
      <svg className="absolute inset-0" width={LUPE} height={LUPE}>
        <polygon points={linie} fill="none" stroke="white" strokeWidth={2} />
        {/* Fadenkreuz auf dem gezogenen Punkt */}
        <path d={`M${LUPE / 2} ${LUPE / 2 - 14}v28M${LUPE / 2 - 14} ${LUPE / 2}h28`} stroke="#f43f5e" strokeWidth={1.5} />
      </svg>
    </div>
  );
}

/** Vollbild-Editor: vier Ecken frei ziehen, drehen, beim Übernehmen gerade entzerren */
export function BildZuschnitt({ datei, onFertig, onAbbrechen }: { datei: File; onFertig: (f: File) => void; onAbbrechen: () => void }) {
  // original: ungefiltert (ggf. gedreht); bild: angezeigte, gefilterte Fassung
  const [original, setOriginal] = useState<HTMLImageElement | null>(null);
  const [bild, setBild] = useState<HTMLImageElement | null>(null);
  const [viereck, setViereck] = useState<Viereck>(VOLL);
  const [erkannt, setErkannt] = useState<Viereck | null>(null);
  const [gedreht, setGedreht] = useState(false);
  const [arbeitet, setArbeitet] = useState(false);
  const [filter, setFilter] = useState<Filter>(() => {
    try {
      const f = localStorage.getItem(FILTER_SPEICHER);
      return FILTER.some((x) => x.wert === f) ? (f as Filter) : "original";
    } catch {
      return "original";
    }
  });
  const [filtert, setFiltert] = useState(false);
  const flaeche = useRef<HTMLDivElement>(null);
  const buehne = useRef<HTMLDivElement>(null);
  const [platz, setPlatz] = useState({ b: 0, h: 0 });
  const zug = useRef<{ griff: Griff; startX: number; startY: number; start: Viereck } | null>(null);
  // Lupe beim Ziehen eines Griffs: Fingerposition (Bildschirm) und gezogener Griff
  const [lupe, setLupe] = useState<{ griff: Exclude<Griff, "mitte">; x: number; y: number } | null>(null);
  const abbrechenRef = useRef(onAbbrechen);
  abbrechenRef.current = onAbbrechen;

  useEffect(() => {
    let aktiv = true;
    bildLaden(datei)
      .then((b) => {
        if (!aktiv) return;
        setOriginal(b);
        // Bon bei eindeutigem Kontrast gleich selbst finden
        let gefunden: Viereck | null = null;
        try {
          gefunden = bonErkennen(b);
        } catch {
          gefunden = null;
        }
        setErkannt(gefunden);
        if (gefunden) setViereck(gefunden);
      })
      .catch(() => abbrechenRef.current());
    const esc = (e: KeyboardEvent) => e.key === "Escape" && abbrechenRef.current();
    window.addEventListener("keydown", esc);
    return () => {
      aktiv = false;
      window.removeEventListener("keydown", esc);
      urlsFreigeben();
    };
  }, [datei]);

  // Filter auf die angezeigte Fassung anwenden
  useEffect(() => {
    if (!original) return;
    let aktiv = true;
    setFiltert(true);
    // kurz warten, damit „Filter …“ gezeichnet wird, bevor die Rechnung den Browser blockiert
    const zeit = setTimeout(() => {
      gefiltert(original, filter)
        .then((b) => aktiv && setBild(b))
        .catch(() => aktiv && setBild(original))
        .finally(() => aktiv && setFiltert(false));
    }, 30);
    try {
      localStorage.setItem(FILTER_SPEICHER, filter);
    } catch {
      // ohne Speicher eben nur für dieses Foto
    }
    return () => {
      aktiv = false;
      clearTimeout(zeit);
    };
  }, [original, filter]);

  // verfügbaren Platz messen, damit Bild und Rahmen exakt übereinander liegen
  useEffect(() => {
    const el = buehne.current;
    if (!el) return;
    const beobachter = new ResizeObserver(([e]) => setPlatz({ b: e.contentRect.width, h: e.contentRect.height }));
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, []);
  const verhaeltnis = bild ? bild.naturalWidth / bild.naturalHeight : 1;
  const anzeigeB = Math.min(platz.b, platz.h * verhaeltnis);
  const anzeigeH = anzeigeB / verhaeltnis;

  const runter = (griff: Griff) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // ohne Capture geht es auch, die Bewegung wird an der Bühne abgefangen
    }
    zug.current = { griff, startX: e.clientX, startY: e.clientY, start: viereck };
    if (griff !== "mitte") setLupe({ griff, x: e.clientX, y: e.clientY });
  };

  const bewegen = (e: React.PointerEvent) => {
    const z = zug.current;
    const box = flaeche.current?.getBoundingClientRect();
    if (!z || !box) return;
    const dx = (e.clientX - z.startX) / box.width;
    const dy = (e.clientY - z.startY) / box.height;
    const s = z.start;
    const verschoben = (p: Punkt, ddx: number, ddy: number): Punkt => ({ x: begrenzen(p.x + ddx, 0, 1), y: begrenzen(p.y + ddy, 0, 1) });
    let neu: Viereck;
    if (z.griff === "mitte") {
      // ganzen Rahmen verschieben, ohne dass eine Ecke aus dem Bild läuft
      const ddx = begrenzen(dx, -Math.min(...s.map((p) => p.x)), 1 - Math.max(...s.map((p) => p.x)));
      const ddy = begrenzen(dy, -Math.min(...s.map((p) => p.y)), 1 - Math.max(...s.map((p) => p.y)));
      neu = s.map((p) => verschoben(p, ddx, ddy)) as Viereck;
    } else if (typeof z.griff === "number") {
      // jede Ecke einzeln – der Rahmen darf schief werden
      neu = s.map((p, i) => (i === z.griff ? verschoben(p, dx, dy) : p)) as Viereck;
    } else {
      // Kante: beide Ecken der Kante gemeinsam
      const [a, b] = KANTEN[z.griff];
      neu = s.map((p, i) => (i === a || i === b ? verschoben(p, dx, dy) : p)) as Viereck;
    }
    setViereck(neu);
    if (z.griff !== "mitte") setLupe({ griff: z.griff, x: e.clientX, y: e.clientY });
  };

  const loslassen = () => {
    zug.current = null;
    setLupe(null);
  };

  const drehenKlick = async () => {
    if (!original) return;
    setArbeitet(true);
    setOriginal(await drehen(original));
    // Ecken mitdrehen (90° im Uhrzeigersinn): (x, y) -> (1 - y, x); die alte Ecke unten links wird oben links
    const mitdrehen = (v: Viereck): Viereck => {
      const d = v.map((p) => ({ x: 1 - p.y, y: p.x }));
      return [d[3], d[0], d[1], d[2]];
    };
    setViereck(mitdrehen);
    setErkannt((e) => e && mitdrehen(e));
    setGedreht(true);
    setArbeitet(false);
  };

  const uebernehmen = async () => {
    if (!bild) return;
    if (!gedreht && istVoll(viereck) && filter === "original") return onFertig(datei);
    setArbeitet(true);
    // dem Browser Zeit geben, „Moment …“ zu zeichnen, bevor die Rechnung startet
    await new Promise((ok) => setTimeout(ok, 30));
    onFertig(await entzerren(original ?? bild, viereck, datei.name, filter));
  };

  const griffe: Exclude<Griff, "mitte">[] = [0, 1, 2, 3, "k01", "k12", "k23", "k30"];
  const xy = (p: Punkt) => ({ x: p.x * anzeigeB, y: p.y * anzeigeH });
  const ecken = viereck.map(xy);
  const linie = ecken.map((p) => `${p.x},${p.y}`).join(" ");
  // Drittel-Hilfslinien im (schiefen) Rahmen
  const hilfen = bild ? [1 / 3, 2 / 3].flatMap((t) => {
    const abb = quadratAufViereck(viereck);
    const [ax, ay] = abb(t, 0), [bx, by] = abb(t, 1), [cx, cy] = abb(0, t), [dx, dy] = abb(1, t);
    return [
      [ax * anzeigeB, ay * anzeigeH, bx * anzeigeB, by * anzeigeH],
      [cx * anzeigeB, cy * anzeigeH, dx * anzeigeB, dy * anzeigeH],
    ];
  }) : [];

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={t("Bild zuschneiden")}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button className="rounded-lg px-3 py-2 text-sm hover:bg-white/10" onClick={onAbbrechen}>
          {t("Abbrechen")}
        </button>
        <span className="text-center text-sm text-white/70 max-sm:hidden">{erkannt ? t("Bon automatisch erkannt") : t("Ecken auf den Bon ziehen")}</span>
        <div className="flex">
          {erkannt && (
            <button
              className="rounded-lg px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
              onClick={() => setViereck(erkannt)}
              disabled={viereck.every((p, i) => p.x === erkannt[i].x && p.y === erkannt[i].y)}
            >
              {t("Automatisch")}
            </button>
          )}
          <button className="rounded-lg px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40" onClick={() => setViereck(VOLL)} disabled={istVoll(viereck)}>
            {t("Ganzes Bild")}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 p-6" onPointerMove={bewegen} onPointerUp={loslassen} onPointerCancel={loslassen}>
        <div ref={buehne} className="flex size-full items-center justify-center">
          {bild && anzeigeB > 0 ? (
            <div ref={flaeche} className="relative touch-none select-none" style={{ width: anzeigeB, height: anzeigeH }}>
              <img src={bild.src} alt="" draggable={false} className="pointer-events-none size-full" />
              <svg className="absolute inset-0 overflow-visible" width={anzeigeB} height={anzeigeH}>
                {/* abgedunkelter Bereich außerhalb des Rahmens */}
                <path
                  d={`M-2000 -2000H${anzeigeB + 2000}V${anzeigeH + 2000}H-2000Z M${ecken.map((p) => `${p.x} ${p.y}`).join(" L")}Z`}
                  fill="rgba(0,0,0,.55)"
                  fillRule="evenodd"
                  pointerEvents="none"
                />
                {hilfen.map(([x1, y1, x2, y2], i) => (
                  <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,.25)" pointerEvents="none" />
                ))}
                <polygon points={linie} fill="transparent" stroke="white" strokeWidth={2} onPointerDown={runter("mitte")} style={{ cursor: "move" }} />
              </svg>
              {griffe.map((g) => {
                const p = xy(griffPunkt(viereck, g));
                const ecke = typeof g === "number";
                return (
                  <span
                    key={g}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${ecke ? "size-7 bg-akzent" : "size-5 bg-white/80"}`}
                    style={{ left: p.x, top: p.y, cursor: "grab" }}
                    onPointerDown={runter(g)}
                  />
                );
              })}
            </div>
          ) : (
            <span className="size-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
          )}
        </div>
      </div>

      {lupe && bild && (
        <Lupe bild={bild} viereck={viereck} punkt={griffPunkt(viereck, lupe.griff)} fingerX={lupe.x} fingerY={lupe.y} anzeigeB={anzeigeB} anzeigeH={anzeigeH} />
      )}

      <p className="pb-1.5 text-center text-xs text-white/60 sm:hidden">{erkannt ? t("Bon automatisch erkannt – Ecken bei Bedarf nachziehen") : t("Ecken auf den Bon ziehen")}</p>
      <div className="flex justify-center gap-1.5 overflow-x-auto px-4 pt-1">
        {FILTER.map((f) => (
          <button
            key={f.wert}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${filter === f.wert ? "border-white bg-white text-black" : "border-white/30 text-white/80 hover:bg-white/10"}`}
            onClick={() => setFilter(f.wert)}
            disabled={filtert || arbeitet}
          >
            {f.text}
          </button>
        ))}
      </div>

      <div className="unten-sicher flex items-center justify-between gap-3 px-4 py-3">
        <button className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40" onClick={drehenKlick} disabled={!bild || arbeitet || filtert}>
          <Symbol name="drehen" className="size-5" /> {t("Drehen")}
        </button>
        {filtert && <span className="text-xs text-white/60">{t("Filter …")}</span>}
        <button className="knopf-haupt px-6" onClick={uebernehmen} disabled={!bild || arbeitet || filtert}>
          {arbeitet ? t("Entzerrt …") : t("Übernehmen")}
        </button>
      </div>
    </div>
  );
}
