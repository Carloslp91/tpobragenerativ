// VARIABLES GLOBALES

let mic, fft, lienzoTexture;

// Grilla
let targetCellSize = 50;
let numCols, numRows, cellW, cellH, gridStartX;
let cells = [];

// Silencio
const SILENCE_THRESHOLD    = 0.05;
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

let paletteSilent;

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

    paletteSilent = [
        color(100, 12, 12), color(130, 20, 20), color( 70,  8,  8),
        color(110, 25, 25), color( 12, 70, 20), color( 18, 90, 28),
        color(  8, 55, 15), color( 25, 75, 32), color( 12, 25, 85),
        color( 15, 35,105), color(  8, 18, 65), color( 22, 18, 72),
        color( 28, 14, 78)
    ];

    initGrid();
}

// GRILLA

function initGrid() {
    let gridWidth = width / 3;
    gridStartX = (width - gridWidth) / 2;

    numCols = ceil(gridWidth / targetCellSize);
    numRows = ceil(height   / targetCellSize);
    cellW   = gridWidth / numCols;
    cellH   = height    / numRows;

    let cx      = (numCols - 1) / 2;
    let cy      = (numRows - 1) / 2;
    let maxDist = dist(0, 0, cx, cy);

    cells = [];
    for (let i = 0; i < numCols; i++) {
        cells[i] = [];
        for (let j = 0; j < numRows; j++) {
            let d    = dist(i, j, cx, cy) / maxDist;
            let zone = d < 0.33 ? 'bass' : d < 0.66 ? 'mid' : 'treble';
            cells[i][j] = {
                nx: random(-1, 1),
                ny: random(-1, 1),
                colorSilentA:     random(paletteSilent),
                colorSilentB:     random(paletteSilent),
                silentBrightness: random(0.2, 0.7),
                distToCenter:     d,
                bandZone:         zone,
                noiseOffsetX:     random(1000),
                noiseOffsetY:     random(1000),
                // Fase individual para que cada celda vibre distinto
                phaseX:           random(TWO_PI),
                phaseY:           random(TWO_PI),
                displayColor:     color(50, 50, 50),
                lightBurst:       0   // nivel de luz 0–1, decae con el tiempo
            };
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

    const px = 16, py = 16, hw = 220, hh = 230;

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

    // ── Volumen y picos ──────────────────────────────────────────────────
    let vol = constrain(mic.getLevel() * 6, 0, 1.5);

    let peak = max(0, vol - peakLevel);
    peakLevel = lerp(peakLevel, vol, 0.15);

    if (peak > 0.2 && !shockwaveActive) {
        shockwaveActive   = true;
        shockwaveRadius   = 0;
        shockwaveStrength = constrain(peak * 5, 0, 1);
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

    if (wasSilent && !isSilent) { targetCellSize = random(30, 90); initGrid(); }
    wasSilent = isSilent;

    // ── Espectro ─────────────────────────────────────────────────────────
    let spectrum = fft.analyze();

    smoothBass   = lerp(smoothBass,   bandAverage(spectrum,  0,  10), 0.35);
    smoothMid    = lerp(smoothMid,    bandAverage(spectrum, 10,  80), 0.20);
    smoothTreble = lerp(smoothTreble, bandAverage(spectrum, 80, 256), 0.15);

    let bass   = constrain(smoothBass   * 3.5, 0, 1);
    let mid    = constrain(smoothMid    * 2.5, 0, 1);
    let treble = constrain(smoothTreble * 3.0, 0, 1);

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

    // Frecuencia base de vibración por zona (en radianes/frame)
    let bassFreq   = 0.08;   // Lenta y pesada — pulso de 8 frames aprox.
    let midFreq    = 0.18;   // Media — oscilación lateral fluida
    let trebleFreq = 0.55;   // Rápida y nerviosa — temblor fino

    for (let i = 0; i < numCols; i++) {
        for (let j = 0; j < numRows; j++) {
            let cell = cells[i][j];
            let d    = cell.distToCenter;
            let x    = gridStartX + i * cellW + cellW / 2;
            let y    = j * cellH  + cellH / 2;

            // ── Tamaño base por bandas ────────────────────────────────────
            let bI = cell.bandZone === 'bass'   ? 1.0 : cell.bandZone === 'mid' ? 0.5 : 0.1;
            let tI = cell.bandZone === 'treble' ? 1.0 : cell.bandZone === 'mid' ? 0.5 : 0.1;
            let w  = cellW * (1 + bass * 1.8 * bI * max(0.1, abs(cell.nx))) + cellW * treble * 1.4 * tI;
            let h  = cellH * (1 + bass * 1.8 * bI * max(0.1, abs(cell.ny))) + cellH * treble * 1.4 * tI;

            // ── Onda expansiva + ola de luz ───────────────────────────────
            if (shockwaveActive) {
                let waveEffect = max(0, 1 - abs(d - shockwaveRadius) * 6) * shockwaveStrength;
                w += waveEffect * cellW * 2.0;
                h += waveEffect * cellH * 2.0;

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
                vibW = cellW * bassPulse * 1.2;
                vibH = cellH * bassPulse * 1.2;
                // Leve desplazamiento vertical que acompaña el pulso
                vibY = sin(frameCount * bassFreq * 0.7 + cell.phaseY) * cellH * 0.12 * bass;

            } else if (cell.bandZone === 'mid') {
                // Medios: balanceo horizontal suave, como una ola
                vibX = sin(frameCount * midFreq + cell.phaseX) * cellW * 0.35 * mid;
                // Leve achatamiento vertical complementario (cuando va a los lados se comprime)
                vibH = -abs(sin(frameCount * midFreq + cell.phaseX)) * cellH * 0.2 * mid;

            } else {
                // Agudos: temblor fino y errático en ambos ejes
                // Dos senos desfasados crean trayectoria tipo Lissajous pequeña
                vibX = (sin(frameCount * trebleFreq       + cell.phaseX) * 0.6 +
                        sin(frameCount * trebleFreq * 1.7 + cell.phaseY) * 0.4)
                       * cellW * 0.28 * treble;
                vibY = (sin(frameCount * trebleFreq * 1.3 + cell.phaseY) * 0.6 +
                        sin(frameCount * trebleFreq * 2.1 + cell.phaseX) * 0.4)
                       * cellH * 0.28 * treble;
            }

            // ── Movimiento continuo XY con Perlin noise ───────────────────
            let flowX = 0, flowY = 0;
            if (activityLevel > 0.02) {
                flowX = map(noise(cell.noiseOffsetX + frameCount * noiseSpeed), 0, 1, -1, 1) * cellW * 0.20 * activityLevel;
                flowY = map(noise(cell.noiseOffsetY + frameCount * noiseSpeed), 0, 1, -1, 1) * cellH * 0.20 * activityLevel;
            }

            // ── Vibración rápida con shhh ─────────────────────────────────
            let shhhX = 0, shhhY = 0;
            if (isShhh) {
                shhhX = map(noise(cell.noiseOffsetX + frameCount * 0.12 + 500), 0, 1, -1, 1) * cellW * 0.45 * shhhAmt;
                shhhY = map(noise(cell.noiseOffsetY + frameCount * 0.12 + 500), 0, 1, -1, 1) * cellH * 0.45 * shhhAmt;
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

            drawOrder.push({
                x: x + flowX + shhhX + vibX,
                y: y + flowY + shhhY + vibY,
                w: max(2, w + vibW),
                h: max(2, h + vibH),
                currentColor: cell.displayColor,
                lightBurst:   cell.lightBurst,
                texSrcX:      gridStartX + i * cellW,
                texSrcY:      j * cellH
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
        noFill();
        stroke(20);
        strokeWeight(2);
        rect(0, 0, d.w, d.h);

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
