// VARIABLES GLOBALES

let mic, fft, lienzoTexture;

// Grilla
let targetCellSize = 40;
let numCols, numRows, cellW, cellH;
// Marco fijo de la obra: posición y tamaño del área que nunca se mueve ni se redimensiona
let gridStartX, gridStartY, gridWidth, gridHeight;
let cells = [];

// Sensibilidad del micrófono (antes estaba en 6, reaccionaba a cualquier ruido de fondo)
const MIC_SENSITIVITY = 1.1;

// Calibración automática de ruido ambiente (noise gate): al arrancar, mide el
// piso de ruido de la sala durante unos segundos y lo resta de cada lectura,
// así el ruido de fondo constante (aire acondicionado, murmullo, etc.) no
// dispara la obra — solo lo que suena claramente por encima de ese piso.
const CALIBRATION_FRAMES = 90;      // ~1.5s a 60fps
const NOISE_GATE_MARGIN  = 1.6;     // margen de seguridad sobre el piso medido
let calibrating       = true;
let calibrationFrames = 0;
let calibrationSum    = 0;
let noiseFloor         = 0;

// Silencio
const SILENCE_THRESHOLD    = 0.09;
const SILENCE_FRAMES_NEEDED = 40;
let silenceFrames = 0;
let wasSilent     = true;

// Bandas de frecuencia suavizadas
let smoothBass   = 0;
let smoothMid    = 0;
let smoothTreble = 0;
let activityLevel = 0;

// Detección de picos (chasquidos / palmadas)
let peakLevel = 0;

// Onda expansiva
let shockwaveRadius   = 0;
let shockwaveActive   = false;
let shockwaveStrength = 0;

// Ola de luz (blanco/amarillo que emana del centro con la onda)
// Cada celda guarda su propio nivel de luz actual para que el fade sea independiente
// lightBurst[i][j] va de 0 a 1 y decae por sí solo cada frame

// Detección de "shhh"
const TREBLE_SUSTAIN_THRESHOLD = 0.12;
const TREBLE_SUSTAIN_FRAMES    = 12;
let trebleSustainFrames = 0;

// Vocal detectada
const VOCAL_COLORS = {
    A: [255,  50,  20],
    E: [ 50, 220,  80],
    I: [ 30, 180, 255],
    O: [220,  50, 220],
    U: [ 20,  20, 200],
};
let lastVowel       = null;
let vowelConfidence = 0;
let currentVocalR   = 255;
let currentVocalG   = 150;
let currentVocalB   = 50;

// HUD
const HUD_HISTORY = 60;
let volHistory = new Array(HUD_HISTORY).fill(0);
let hudData    = {};

// Gradiente radial frío → cálido (imita el "núcleo" luminoso de mosaicos tipo Paul Klee).
// Índice 0 = borde/frío, último índice = centro/cálido.
let radialPalette;
let outlierPalette;

// Devuelve un color interpolado del gradiente radial según t (0 = frío/borde, 1 = cálido/centro)
function paletteColorAt(t) {
    t = constrain(t, 0, 1);
    let idx  = t * (radialPalette.length - 1);
    let i0   = floor(idx);
    let i1   = min(i0 + 1, radialPalette.length - 1);
    let frac = idx - i0;
    return lerpColor(radialPalette[i0], radialPalette[i1], frac);
}

// SETUP / PRELOAD

function preload() {
    lienzoTexture = loadImage("textura/lienzo.jpg");
}

function setup() {
    createCanvas(windowWidth, windowHeight);

    userStartAudio();
    mic = new p5.AudioIn();
    mic.start();
    fft = new p5.FFT(0.85, 2048);
    fft.setInput(mic);

    rectMode(CENTER);
    angleMode(RADIANS);

    radialPalette = [
        color( 48,  62,  75),   // azul-gris (borde, más claro que el fondo)
        color( 55,  68,  55),   // verde oliva oscuro
        color( 70,  80,  55),   // oliva
        color( 95,  90,  50),   // oliva dorado
        color(125,  90,  42),   // marrón cálido
        color(160,  80,  35),   // óxido / rust
        color(195,  75,  30),   // rojo-naranja
        color(225, 110,  30),   // naranja
        color(245, 170,  50),   // naranja dorado
        color(255, 215, 110),   // amarillo brillante
        color(255, 245, 200)    // núcleo casi blanco (centro, punto más brillante)
    ];

    // Celdas "atípicas": rompen el degradé perfecto con toques de color que no
    // siguen la regla radial — como en un mosaico pintado a mano. Incluye un azul
    // bien saturado (no el azul-gris apagado del borde) para que se note como acento.
    outlierPalette = [
        color( 35,  85, 150),   // azul saturado
        color( 45, 100, 165),   // azul medio
        color( 30,  60, 110),   // azul oscuro
        color( 90,  60, 120),   // violeta
        color( 60,  95,  80)    // verde profundo
    ];

    initGrid();
}

// GRILLA

function initGrid() {
    // Marco fijo de la obra: arranca en la esquina superior izquierda y nunca se recentra.
    // Ahora es cuadrado (antes era una franja vertical de width/3 x height):
    // el lado del cuadrado es el menor entre ancho y alto de la ventana, para que siempre entre completo.
    let side   = min(width, height);
    gridWidth  = side;
    gridHeight = side;
    gridStartX = 0;
    gridStartY = 0;

    numCols = ceil(gridWidth  / targetCellSize);
    numRows = ceil(gridHeight / targetCellSize);
    cellW   = gridWidth  / numCols;
    cellH   = gridHeight / numRows;

    let cx      = (numCols - 1) / 2;
    let cy      = (numRows - 1) / 2;
    let maxDist = dist(0, 0, cx, cy);

    cells = [];
    for (let i = 0; i < numCols; i++) {
        cells[i] = [];
        for (let j = 0; j < numRows; j++) {
            let d    = dist(i, j, cx, cy) / maxDist;
            let zone = d < 0.33 ? 'bass' : d < 0.66 ? 'mid' : 'treble';

            // Calidez base: 1 = centro (cálido/brillante), 0 = borde (frío/oscuro).
            // Antes decaía rápido desde el centro, dejando mucha zona oscura.
            // Ahora se "empuja" la distancia hacia afuera (dEff) antes de invertirla,
            // así la calidez se mantiene alta en la mayor parte del lienzo y solo
            // cae fuerte muy cerca del borde exterior — lo oscuro queda como un marco fino.
            let dEff   = pow(d, 1.5);
            let warmth = constrain(pow(max(0, 1 - dEff), 0.8) + random(-0.10, 0.10), 0, 1);

            // ~12% de las celdas de la zona oscura/borde son "atípicas": ignoran el
            // degradé radial y toman un color de acento (azul saturado, violeta, verde
            // profundo), como pasa en un mosaico pintado a mano. Se excluye el núcleo
            // y la zona cálida intermedia (d < 0.55) para no romper el brillo.
            let isOutlier = d > 0.55 && random() < 0.12;
            let colA, colB;
            if (isOutlier) {
                colA = random(outlierPalette);
                colB = random(outlierPalette);
            } else {
                colA = paletteColorAt(constrain(warmth + random(-0.04, 0.04), 0, 1));
                colB = paletteColorAt(constrain(warmth + random(-0.04, 0.04), 0, 1));
            }

            cells[i][j] = {
                nx: random(-1, 1),
                ny: random(-1, 1),
                colorSilentA:     colA,
                colorSilentB:     colB,
                silentBrightness: random(0.2, 0.7),
                distToCenter:     d,
                bandZone:         zone,
                noiseOffsetX:     random(1000),
                noiseOffsetY:     random(1000),
                // Fase individual para que cada celda vibre distinto
                phaseX:           random(TWO_PI),
                phaseY:           random(TWO_PI),
                displayColor:     color(50, 50, 50),
                lightBurst:       0   // nivel de luz 0–1, decae por sí solo
            };
        }
    }
}

// Restringe un rectángulo (x,y = centro, con rectMode CENTER) para que quede
// siempre completamente contenido dentro del marco fijo de la obra.
// Los efectos de audio pueden seguir agrandando, moviendo o deformando la celda,
// pero nunca se le permite cruzar el borde exterior de la grilla.
function clampToFrame(x, y, w, h) {
    // Ningún cuadrado individual puede ser más grande que el propio marco
    w = min(w, gridWidth);
    h = min(h, gridHeight);

    let halfW = w / 2;
    let halfH = h / 2;

    // Se reubica el centro del rectángulo (no se recorta el dibujo) para que
    // sus bordes nunca sobrepasen el marco fijo
    x = constrain(x, gridStartX + halfW, gridStartX + gridWidth  - halfW);
    y = constrain(y, gridStartY + halfH, gridStartY + gridHeight - halfH);

    return { x, y, w, h };
}

// COLISIONES

// Separa dos rectángulos (x,y = centro) que se están superponiendo,
// empujándolos en el eje de menor solapamiento. Modifica los objetos in-place.
function separateRects(a, b) {
    let ax1 = a.x - a.w / 2, ax2 = a.x + a.w / 2;
    let ay1 = a.y - a.h / 2, ay2 = a.y + a.h / 2;
    let bx1 = b.x - b.w / 2, bx2 = b.x + b.w / 2;
    let by1 = b.y - b.h / 2, by2 = b.y + b.h / 2;

    let overlapX = min(ax2, bx2) - max(ax1, bx1);
    let overlapY = min(ay2, by2) - max(ay1, by1);

    if (overlapX <= 0 || overlapY <= 0) return; // no se tocan

    // Empuja por el eje donde el solapamiento es menor (separación más corta)
    if (overlapX < overlapY) {
        let push = overlapX / 2;
        if (a.x < b.x) { a.x -= push; b.x += push; }
        else            { a.x += push; b.x -= push; }
    } else {
        let push = overlapY / 2;
        if (a.y < b.y) { a.y -= push; b.y += push; }
        else            { a.y += push; b.y -= push; }
    }
}

// Recorre la grilla y resuelve colisiones solo entre celdas vecinas
// (derecha, abajo y ambas diagonales) — evita el costo O(n²) de comparar
// todas las celdas contra todas, ya que dos celdas no adyacentes en la
// grilla no pueden llegar a tocarse con los desplazamientos actuales.
function resolveCollisions(bounds, iterations = 3) {
    const neighborOffsets = [[1, 0], [0, 1], [1, 1], [1, -1]];

    for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < numCols; i++) {
            for (let j = 0; j < numRows; j++) {
                let a = bounds[i][j];
                for (let [dx, dy] of neighborOffsets) {
                    let ni = i + dx, nj = j + dy;
                    if (ni < 0 || ni >= numCols || nj < 0 || nj >= numRows) continue;
                    separateRects(a, bounds[ni][nj]);
                }
            }
        }
    }
}

// AUDIO — UTILIDADES

function bandAverage(spectrum, start, end) {
    let sum = 0;
    for (let i = start; i < end; i++) sum += spectrum[i];
    return map(sum / ((end - start) * 255), 0, 1, 0, 1);
}

function peakBin(spectrum, start, end) {
    let maxVal = 0, maxIdx = start;
    for (let i = start; i < end; i++) {
        if (spectrum[i] > maxVal) { maxVal = spectrum[i]; maxIdx = i; }
    }
    return { bin: maxIdx, val: maxVal / 255.0 };
}

// Detecta vocal usando posición de F1 (~300–900 Hz) y ratio F2/F1 (~800–3000 Hz)
function detectVowel(spectrum, vol) {
    if (vol < 0.08) return { vowel: null, confidence: 0 };
    if (bandAverage(spectrum, 14, 120) < 0.03) return { vowel: null, confidence: 0 };

    let f1 = peakBin(spectrum, 14,  42);
    let f2 = peakBin(spectrum, 37, 140);

    if (f1.val < 0.05) return { vowel: null, confidence: 0 };

    let ratio  = f2.bin / (f1.bin + 1);
    let f1Norm = map(f1.bin, 14, 42, 0, 1);

    let vowel;
    if      (ratio > 3.5)                  vowel = 'I';
    else if (ratio > 2.5 && f1Norm > 0.4) vowel = 'E';
    else if (f1Norm > 0.6 && ratio < 3.0) vowel = 'A';
    else if (ratio < 2.0 && f1Norm > 0.3) vowel = 'O';
    else                                   vowel = 'U';

    return { vowel, confidence: constrain(f1.val * 3, 0, 1) };
}

// HUD

function drawHUD() {
    push();
    resetMatrix();

    const hw = 220, hh = 230;
    // El marco de la obra es cuadrado (lado = min(width, height)) y arranca en (0,0).
    // Si sobra espacio a la derecha (pantalla más ancha que alta) el HUD va ahí;
    // si sobra espacio abajo (pantalla más alta que ancha) el HUD va debajo del cuadrado.
    let px, py;
    if (width > height) {
        px = width - hw - 20;
        py = 20;
    } else {
        px = 20;
        py = gridHeight + 20;
    }

    noStroke();
    fill(0, 0, 0, 175);
    rectMode(CORNER);
    rect(px, py, hw, hh, 6);

    noFill();
    stroke(255, 255, 255, 30);
    strokeWeight(1);
    rect(px, py, hw, hh, 6);

    noStroke();
    fill(200, 200, 200);
    textFont('monospace');
    textSize(9);
    textAlign(LEFT, TOP);
    text('AUDIO MONITOR', px + 10, py + 10);

    stroke(255, 255, 255, 25);
    line(px + 10, py + 22, px + hw - 10, py + 22);

    if (calibrating) {
        noStroke();
        fill(255, 210, 90);
        textSize(11);
        textAlign(LEFT, TOP);
        text('CALIBRANDO RUIDO AMBIENTE...', px + 10, py + 40);
        fill(160, 160, 160);
        textSize(9);
        text('Quedate en silencio un momento', px + 10, py + 58);
        pop();
        return;
    }

    let wfX = px + 10, wfY = py + 30, wfW = hw - 20, wfH = 28;
    noFill();
    stroke(80, 200, 120, 180);
    strokeWeight(1);
    beginShape();
    for (let i = 0; i < HUD_HISTORY; i++) {
        vertex(
            wfX + map(i, 0, HUD_HISTORY - 1, 0, wfW),
            wfY + wfH / 2 - volHistory[i] * (wfH / 2) * 0.9
        );
    }
    endShape();

    stroke(255, 255, 255, 15);
    line(wfX, wfY + wfH / 2, wfX + wfW, wfY + wfH / 2);

    const metrics = [
        { label: 'VOLUMEN',   value: hudData.vol,      color: [ 80, 200, 120] },
        { label: 'GRAVE',     value: hudData.bass,     color: [255, 100,  40] },
        { label: 'MEDIO',     value: hudData.mid,      color: [255, 210,  60] },
        { label: 'AGUDO',     value: hudData.treble,   color: [ 60, 160, 255] },
        { label: 'ACTIVIDAD', value: hudData.activity, color: [200, 100, 255] },
    ];

    let barX   = px + 10;
    let barW   = hw - 20;
    let barH   = 10;
    let startY = py + 68;
    let rowGap = 24;

    for (let i = 0; i < metrics.length; i++) {
        let m = metrics[i];
        let y = startY + i * rowGap;
        let v = constrain(m.value, 0, 1);

        noStroke();
        fill(160, 160, 160);
        textSize(8);
        textAlign(LEFT, TOP);
        text(m.label, barX, y);

        fill(220, 220, 220);
        textAlign(RIGHT, TOP);
        text(nf(v * 100, 1, 0) + '%', barX + barW, y);

        fill(255, 255, 255, 18);
        rectMode(CORNER);
        rect(barX, y + 11, barW, barH, 3);

        fill(m.color[0], m.color[1], m.color[2], 210);
        rect(barX, y + 11, barW * v, barH, 3);
    }

    let stY       = startY + metrics.length * rowGap + 4;
    let vocalLabel = hudData.vowel ? hudData.vowel : '—';
    let vocalRGB   = hudData.vowel ? VOCAL_COLORS[hudData.vowel] : [120, 120, 120];

    noStroke();
    fill(120, 120, 120);
    textSize(8);
    textAlign(LEFT, TOP);
    text('VOCAL', barX, stY);

    fill(vocalRGB[0], vocalRGB[1], vocalRGB[2]);
    textSize(16);
    text(vocalLabel, barX, stY + 9);

    let stLabel, stCol;
    if      (hudData.isSilent)   { stLabel = 'SILENCIO'; stCol = [100, 100, 100]; }
    else if (hudData.isShhh)     { stLabel = 'SHHH';     stCol = [ 60, 200, 255]; }
    else if (hudData.shockwave)  { stLabel = 'IMPACTO';  stCol = [255, 200,  40]; }
    else                         { stLabel = 'ACTIVO';   stCol = [ 80, 220, 120]; }

    let dotX = barX + 50, dotY = stY + 16;
    fill(stCol[0], stCol[1], stCol[2]);
    circle(dotX, dotY, 7);
    textSize(9);
    textAlign(LEFT, CENTER);
    text(stLabel, dotX + 8, dotY);

    pop();
}

// DRAW

function draw() {
    background(20);

    let rawLevel = mic.getLevel();

    // ── Calibración de ruido ambiente (una sola vez al arrancar) ───────────
    if (calibrating) {
        calibrationSum += rawLevel;
        calibrationFrames++;
        if (calibrationFrames >= CALIBRATION_FRAMES) {
            noiseFloor  = (calibrationSum / calibrationFrames) * NOISE_GATE_MARGIN;
            calibrating = false;
        }
        drawHUD();          // se ve el HUD también durante la calibración
        return;              // no se dibuja/reacciona nada hasta terminar de medir el piso de ruido
    }

    // ── Volumen y picos ──────────────────────────────────────────────────
    // Se resta el piso de ruido medido: el ruido ambiente constante queda en ~0
    // y solo lo que suena claramente por encima (voz, palmadas) genera señal.
    let gatedLevel = max(0, rawLevel - noiseFloor);
    let vol = constrain(gatedLevel * MIC_SENSITIVITY, 0, 1.5);

    let peak = max(0, vol - peakLevel);
    peakLevel = lerp(peakLevel, vol, 0.15);

    if (peak > 0.2 && !shockwaveActive) {
        shockwaveActive   = true;
        shockwaveRadius   = 0;
        shockwaveStrength = constrain(peak * 3, 0, 1);
    }
    if (shockwaveActive) {
        shockwaveRadius   += 0.035;
        shockwaveStrength *= 0.90;
        if (shockwaveRadius > 2) { shockwaveActive = false; shockwaveRadius = 0; }
    }

    // ── Silencio ─────────────────────────────────────────────────────────
    if (vol < SILENCE_THRESHOLD) silenceFrames = min(silenceFrames + 1, SILENCE_FRAMES_NEEDED + 60);
    else                          silenceFrames = max(silenceFrames - 3, 0);

    let isSilent = silenceFrames >= SILENCE_FRAMES_NEEDED;
    activityLevel = lerp(activityLevel, isSilent ? 0 : constrain(vol, 0, 1), isSilent ? 0.01 : 0.25);

    if (wasSilent && !isSilent) { targetCellSize = random(24, 72); initGrid(); }
    wasSilent = isSilent;

    // ── Espectro ─────────────────────────────────────────────────────────
    let spectrum = fft.analyze();

    smoothBass   = lerp(smoothBass,   bandAverage(spectrum,  0,  10), 0.18);
    smoothMid    = lerp(smoothMid,    bandAverage(spectrum, 10,  80), 0.12);
    smoothTreble = lerp(smoothTreble, bandAverage(spectrum, 80, 256), 0.10);

    let bass   = constrain(smoothBass   * 2.2, 0, 1);
    let mid    = constrain(smoothMid    * 1.6, 0, 1);
    let treble = constrain(smoothTreble * 1.8, 0, 1);

    // ── Shhh ─────────────────────────────────────────────────────────────
    if (treble > TREBLE_SUSTAIN_THRESHOLD && bass < 0.15)
        trebleSustainFrames = min(trebleSustainFrames + 1, 90);
    else
        trebleSustainFrames = max(trebleSustainFrames - 2, 0);

    let isShhh  = trebleSustainFrames >= TREBLE_SUSTAIN_FRAMES;
    let shhhAmt = map(trebleSustainFrames, TREBLE_SUSTAIN_FRAMES, 60, 0, 1, true);

    // ── Vocal ────────────────────────────────────────────────────────────
    let detection = detectVowel(spectrum, vol);

    if (detection.vowel && detection.confidence > 0.15) {
        lastVowel       = detection.vowel;
        vowelConfidence = min(vowelConfidence + 0.08, 1.0);
    } else {
        vowelConfidence = max(vowelConfidence - 0.03, 0);
    }

    let [targetR, targetG, targetB] = (lastVowel && vowelConfidence > 0.1)
        ? VOCAL_COLORS[lastVowel]
        : [255, 160, 40];

    let lerpSpeed = detection.vowel ? 0.12 : 0.04;
    currentVocalR = lerp(currentVocalR, targetR, lerpSpeed);
    currentVocalG = lerp(currentVocalG, targetG, lerpSpeed);
    currentVocalB = lerp(currentVocalB, targetB, lerpSpeed);

    let vocalColor = color(currentVocalR, currentVocalG, currentVocalB);

    // ── HUD data ─────────────────────────────────────────────────────────
    hudData = {
        vol:       constrain(vol / 1.5, 0, 1),
        bass, mid, treble,
        activity:  activityLevel,
        isSilent, isShhh,
        shockwave: shockwaveActive,
        vowel:     vowelConfidence > 0.2 ? lastVowel : null
    };
    volHistory.push(hudData.vol);
    volHistory.shift();

    // ── Grilla ───────────────────────────────────────────────────────────
    let noiseSpeed = map(activityLevel, 0, 1, 0.003, 0.018);
    let drawOrder  = [];

    // Posiciones/tamaños "deseados" de cada celda antes de resolver colisiones
    let bounds = [];
    for (let i = 0; i < numCols; i++) bounds[i] = [];

    // Frecuencia base de vibración por zona (en radianes/frame)
    let bassFreq   = 0.08;   // Lenta y pesada — pulso de 8 frames aprox.
    let midFreq    = 0.18;   // Media — oscilación lateral fluida
    let trebleFreq = 0.55;   // Rápida y nerviosa — temblor fino

    for (let i = 0; i < numCols; i++) {
        for (let j = 0; j < numRows; j++) {
            let cell = cells[i][j];
            let d    = cell.distToCenter;
            let x    = gridStartX + i * cellW + cellW / 2;
            let y    = gridStartY + j * cellH + cellH / 2;

            // ── Tamaño base por bandas ────────────────────────────────────
            let bI = cell.bandZone === 'bass'   ? 1.0 : cell.bandZone === 'mid' ? 0.5 : 0.1;
            let tI = cell.bandZone === 'treble' ? 1.0 : cell.bandZone === 'mid' ? 0.5 : 0.1;
            let w  = cellW * (1 + bass * 1.0 * bI * max(0.1, abs(cell.nx))) + cellW * treble * 0.7 * tI;
            let h  = cellH * (1 + bass * 1.0 * bI * max(0.1, abs(cell.ny))) + cellH * treble * 0.7 * tI;

            // ── Onda expansiva + ola de luz ───────────────────────────────
            if (shockwaveActive) {
                let waveEffect = max(0, 1 - abs(d - shockwaveRadius) * 6) * shockwaveStrength;
                w += waveEffect * cellW * 1.2;
                h += waveEffect * cellH * 1.2;

                // Cuando la cresta de la ola pasa por esta celda, inyectamos luz
                // El pico se inyecta solo si la ola está justo encima (waveEffect alto)
                // y la intensidad depende de la fuerza del shockwave y de qué tan cerca
                // está del centro (celdas internas reciben más luz en el arranque)
                let lightInject = waveEffect * shockwaveStrength * map(d, 0, 1, 1.2, 0.6);
                if (lightInject > cell.lightBurst) {
                    cell.lightBurst = constrain(lightInject, 0, 1);
                }
            }

            // Decaimiento de luz: más lento en el centro (graves), más rápido en el borde
            let decayRate = map(d, 0, 1, 0.04, 0.09);
            cell.lightBurst = max(0, cell.lightBurst - decayRate);

            // ── Vibraciones por zona (sin rotación) ──────────────────────
            let vibX = 0, vibY = 0;
            let vibW = 0, vibH = 0;  // deformación de tamaño

            if (cell.bandZone === 'bass') {
                // Graves: pulso de escala — se expanden y contraen en fase
                // Cada celda tiene su propia fase para evitar movimiento uniforme
                let pulse = sin(frameCount * bassFreq + cell.phaseX) * 0.5 + 0.5;
                let bassPulse = bass * pulse;
                vibW = cellW * bassPulse * 0.6;
                vibH = cellH * bassPulse * 0.6;
                // Leve desplazamiento vertical que acompaña el pulso
                vibY = sin(frameCount * bassFreq * 0.7 + cell.phaseY) * cellH * 0.12 * bass;

            } else if (cell.bandZone === 'mid') {
                // Medios: balanceo horizontal suave, como una ola
                vibX = sin(frameCount * midFreq + cell.phaseX) * cellW * 0.20 * mid;
                // Leve achatamiento vertical complementario (cuando va a los lados se comprime)
                vibH = -abs(sin(frameCount * midFreq + cell.phaseX)) * cellH * 0.12 * mid;

            } else {
                // Agudos: temblor fino y errático en ambos ejes
                // Dos senos desfasados crean trayectoria tipo Lissajous pequeña
                vibX = (sin(frameCount * trebleFreq       + cell.phaseX) * 0.6 +
                        sin(frameCount * trebleFreq * 1.7 + cell.phaseY) * 0.4)
                       * cellW * 0.16 * treble;
                vibY = (sin(frameCount * trebleFreq * 1.3 + cell.phaseY) * 0.6 +
                        sin(frameCount * trebleFreq * 2.1 + cell.phaseX) * 0.4)
                       * cellH * 0.16 * treble;
            }

            // ── Movimiento continuo XY con Perlin noise ───────────────────
            let flowX = 0, flowY = 0;
            if (activityLevel > 0.02) {
                flowX = map(noise(cell.noiseOffsetX + frameCount * noiseSpeed), 0, 1, -1, 1) * cellW * 0.14 * activityLevel;
                flowY = map(noise(cell.noiseOffsetY + frameCount * noiseSpeed), 0, 1, -1, 1) * cellH * 0.14 * activityLevel;
            }

            // ── Vibración rápida con shhh ─────────────────────────────────
            let shhhX = 0, shhhY = 0;
            if (isShhh) {
                shhhX = map(noise(cell.noiseOffsetX + frameCount * 0.12 + 500), 0, 1, -1, 1) * cellW * 0.30 * shhhAmt;
                shhhY = map(noise(cell.noiseOffsetY + frameCount * 0.12 + 500), 0, 1, -1, 1) * cellH * 0.30 * shhhAmt;
            }

            // ── Color ─────────────────────────────────────────────────────
            let silentColor = lerpColor(cell.colorSilentA, cell.colorSilentB, cell.silentBrightness);
            let targetColor;

            if (isSilent) {
                targetColor = silentColor;
            } else {
                let edgeColor    = treble > bass ? color(80, 180, 255) : color(210, 90, 20);
                let spatialColor = lerpColor(edgeColor, vocalColor, constrain(1 - d * 0.9, 0.1, 1.0));
                targetColor      = lerpColor(silentColor, spatialColor, constrain(activityLevel * 1.8, 0, 1));
            }

            cell.displayColor = lerpColor(cell.displayColor, targetColor, 0.09);

            // Tamaño y posición deseados (aún sin colisiones ni límite de marco)
            let finalW = max(2, w + vibW);
            let finalH = max(2, h + vibH);
            let finalX = x + flowX + shhhX + vibX;
            let finalY = y + flowY + shhhY + vibY;

            bounds[i][j] = {
                x: finalX, y: finalY, w: finalW, h: finalH,
                currentColor: cell.displayColor,
                lightBurst:   cell.lightBurst,
                texSrcX:      gridStartX + i * cellW,
                texSrcY:      gridStartY + j * cellH
            };
        }
    }

    // Empuja las celdas que se están superponiendo para que no se pisen
    resolveCollisions(bounds);

    // Recién ahora se limita cada celda al marco fijo de la obra y se arma el drawOrder
    for (let i = 0; i < numCols; i++) {
        for (let j = 0; j < numRows; j++) {
            let b = bounds[i][j];
            let bounded = clampToFrame(b.x, b.y, b.w, b.h);

            drawOrder.push({
                x: bounded.x,
                y: bounded.y,
                w: bounded.w,
                h: bounded.h,
                currentColor: b.currentColor,
                lightBurst:   b.lightBurst,
                texSrcX:      b.texSrcX,
                texSrcY:      b.texSrcY
            });
        }
    }

    drawOrder.sort((a, b) => (a.w * a.h) - (b.w * b.h));

    for (let d of drawOrder) {
        push();
        translate(d.x, d.y);
        // Sin rotación — los rectángulos siempre se mantienen alineados a los ejes

        imageMode(CENTER);
        image(lienzoTexture, 0, 0, d.w, d.h, d.texSrcX, d.texSrcY, cellW, cellH);

        blendMode(MULTIPLY);
        noStroke();
        fill(d.currentColor);
        rect(0, 0, d.w, d.h);

        blendMode(BLEND);
        // Sin contorno marcado: la separación entre bloques se da por contraste
        // de color, no por una línea negra (así lo hace Klee en la obra de referencia)

        // ── Ola de luz: capa aditiva blanca/amarilla encima de todo ──────
        // Se usa ADD para que sume luminosidad sin tapar la textura ni el color
        if (d.lightBurst > 0.01) {
            blendMode(ADD);
            noStroke();
            // Centro del burst: casi blanco puro; al desvanecerse vira a amarillo cálido
            let lr = 255;
            let lg = map(d.lightBurst, 0, 1, 180, 255);  // menos verde = más amarillo al inicio
            let lb = map(d.lightBurst, 0, 1,   0, 200);  // casi sin azul al inicio, sube al desvanecerse
            let la = d.lightBurst * 210;                  // alpha controla la intensidad total
            fill(lr, lg, lb, la);
            rect(0, 0, d.w, d.h);
            blendMode(BLEND);
        }

        pop();
    }

    drawHUD();
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    initGrid();
}
