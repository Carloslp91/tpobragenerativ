let mic;
let fft;

const TARGET_CELL_SIZE = 80;

let numCols, numRows;
let cellW, cellH;
let cells = [];
let wasSilent = true;
let silenceFrames = 0;
const SILENCE_THRESHOLD = 0.12;
const SILENCE_FRAMES_NEEDED = 20;

let paletteSilent;

function setup() {
    createCanvas(windowWidth, windowHeight);

    userStartAudio();
    mic = new p5.AudioIn();
    mic.start();
    fft = new p5.FFT();
    fft.setInput(mic);

    rectMode(CENTER);

    paletteSilent = [
        color(60,  120, 210),
        color(80,  180, 100),
        color(200,  70, 110),
        color(180, 140,  40),
        color(50,  170, 160),
        color(170,  60, 180),
        color(80,  150, 210),
        color(200, 130,  50),
        color(130,  80, 200),
        color(60,  190, 120),
        color(210,  90,  70),
        color(100, 170,  60)
    ];

    initGrid();
}

function initGrid() {
    numCols = ceil(width  / TARGET_CELL_SIZE);
    numRows = ceil(height / TARGET_CELL_SIZE);
    cellW   = width  / numCols;
    cellH   = height / numRows;

    let cx = (numCols - 1) / 2;
    let cy = (numRows - 1) / 2;
    let maxDist = dist(0, 0, cx, cy);

    cells = [];
    for (let i = 0; i < numCols; i++) {
        cells[i] = [];
        for (let j = 0; j < numRows; j++) {
            let d = dist(i, j, cx, cy) / maxDist;

            let zone;
            if (d < 0.33)      zone = 'bass';
            else if (d < 0.66) zone = 'mid';
            else               zone = 'treble';

            cells[i][j] = {
                currentNX:        0,
                currentNY:        0,
                colorSilentA:     random(paletteSilent),
                colorSilentB:     random(paletteSilent),
                silentBrightness: random(0.2, 0.7),
                distToCenter:     d,
                bandZone:         zone
            };
        }
    }
}

function bandAverage(spectrum, start, end) {
    let sum = 0;
    for (let i = start; i < end; i++) sum += spectrum[i];
    return map(sum / ((end - start) * 255), 0, 1, 0, 1);
}

function draw() {
    background(20);

    let vol = mic.getLevel();
    vol = constrain(vol * 6, 0, 1.5);

    if (vol < SILENCE_THRESHOLD) {
        silenceFrames++;
    } else {
        silenceFrames = 0;
    }

    let isSilent = silenceFrames >= SILENCE_FRAMES_NEEDED;

    if (wasSilent && !isSilent) {
        for (let i = 0; i < numCols; i++) {
            for (let j = 0; j < numRows; j++) {
                cells[i][j].currentNX        = random(-1, 1);
                cells[i][j].currentNY        = random(-1, 1);
                cells[i][j].colorSilentA     = random(paletteSilent);
                cells[i][j].colorSilentB     = random(paletteSilent);
                cells[i][j].silentBrightness = random(0.2, 0.7);
            }
        }
    }
    wasSilent = isSilent;

    let spectrum = fft.analyze();

    let bass   = bandAverage(spectrum, 0,   10);
    let mid    = bandAverage(spectrum, 10,  80);
    let treble = bandAverage(spectrum, 80, 512);

    let heatBias = bass * 0.5 + mid * 0.3 + treble * 0.2;

    // colores del gradiente radial de luz
    let colorCenter = color(255, 255, 215); // blanco amarillento
    let colorMid    = color(255, 210,  80); // amarillo
    let colorEdge   = color(210,  90,  20); // naranja

    let boost = min(cellW, cellH) * 0.5;

    let drawOrder = [];

    for (let i = 0; i < numCols; i++) {
        for (let j = 0; j < numRows; j++) {
            let cell = cells[i][j];

            let x = i * cellW + cellW / 2;
            let y = j * cellH + cellH / 2;

            let lightRadius = vol * 1.8;
            let lightAmount = (lightRadius < 0.001) ? 0 :
                              max(0, 1 - cell.distToCenter / lightRadius);

            // color de luz radial: centro blanco → medio amarillo → borde naranja
            let d = cell.distToCenter;
            let hotColor = d < 0.5
                ? lerpColor(colorCenter, colorMid, d * 2)
                : lerpColor(colorMid, colorEdge, (d - 0.5) * 2);

            let currentColor;
            if (isSilent) {
                currentColor = lerpColor(cell.colorSilentA, cell.colorSilentB, cell.silentBrightness);
            } else {
                let colorMix = constrain(lightAmount + heatBias * 0.25, 0, 1);
                currentColor = lerpColor(cell.colorSilentA, hotColor, colorMix);
            }

            let w = cellW + vol * boost * max(0, cell.currentNX);
            let h = cellH + vol * boost * max(0, cell.currentNY);

            drawOrder.push({ x, y, w, h, currentColor });
        }
    }

    drawOrder.sort((a, b) => (a.w * a.h) - (b.w * b.h));

    for (let d of drawOrder) {
        push();
        translate(d.x, d.y);
        fill(d.currentColor);
        stroke(20);
        strokeWeight(2);
        rect(0, 0, d.w, d.h);
        pop();
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    initGrid();
}