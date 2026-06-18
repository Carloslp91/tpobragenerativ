let mic;
let fft;

const TARGET_CELL_SIZE = 50;

let numCols, numRows;
let cellW, cellH;
let gridStartX;
let cells = [];
let bassTime = 0;

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
        color(45, 35, 25),
        color(65, 50, 35),
        color(95, 75, 45),
        color(130, 95, 55),
        color(170, 115, 45),
        color(200, 120, 35),
        color(225, 145, 40),
        color(190, 80, 30),
        color(110, 70, 50),
        color(70, 90, 80),
        color(45, 70, 90),
        color(35, 50, 70)
    ];

    initGrid();
}

function initGrid() {
    let gridWidth = width / 3;
    gridStartX = (width - gridWidth) / 2;

    numCols = ceil(gridWidth / TARGET_CELL_SIZE);
    numRows = ceil(height / TARGET_CELL_SIZE);

    cellW = gridWidth / numCols;
    cellH = height / numRows;

    let cx = (numCols - 1) / 2;
    let cy = (numRows - 1) / 2;

    let maxDist = dist(0, 0, cx, cy);

    cells = [];

    for (let i = 0; i < numCols; i++) {
        cells[i] = [];
        for (let j = 0; j < numRows; j++) {
            let d = dist(i, j, cx, cy) / maxDist;
            let zone;

            if (d < 0.33) zone = "bass";
            else if (d < 0.66) zone = "mid";
            else zone = "treble";

            cells[i][j] = {
                currentNX: 0,
                currentNY: 0,
                jitterX: 0,
                jitterY: 0,
                noiseOffsetX: random(1000),
                noiseOffsetY: random(1000),
                colorSilentA: random(paletteSilent),
                colorSilentB: random(paletteSilent),
                silentBrightness: random(0.2, 0.7),
                distToCenter: d,
                bandZone: zone
            };
        }
    }
}

function bandAverage(spectrum, start, end) {
    let sum = 0;
    for (let i = start; i < end; i++) {
        sum += spectrum[i];
    }
    return map(sum / ((end - start) * 255), 0, 1, 0, 1);
}

function paintCell(x, y, w, h, baseColor) {
    push();
    translate(x, y);
    noStroke();

    for (let k = 0; k < 8; k++) {
        let alpha = map(k, 0, 7, 90, 20);
        let c = lerpColor(
            baseColor,
            color(255),
            random(-0.08, 0.12)
        );

        c.setAlpha(alpha);
        fill(c);

        let offsetX = random(-w * 0.05, w * 0.05);
        let offsetY = random(-h * 0.05, h * 0.05);

        rect(
            offsetX,
            offsetY,
            w * random(0.85, 1.05),
            h * random(0.85, 1.05)
        );
    }
    pop();
}

function draw() {
    background(28, 24, 20);

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
                cells[i][j].currentNX = random(-1, 1);
                cells[i][j].currentNY = random(-1, 1);
                cells[i][j].colorSilentA = random(paletteSilent);
                cells[i][j].colorSilentB = random(paletteSilent);
                cells[i][j].silentBrightness = random(0.2, 0.7);
            }
        }
    }

    wasSilent = isSilent;

    let spectrum = fft.analyze();

    // CORRECCIÓN AQUÍ: Se extrajo bassTime += 0.01 de los argumentos de bandAverage
    let bass = bandAverage(spectrum, 0, 10);
    bassTime += 0.01; 

    let mid = bandAverage(spectrum, 10, 80);
    let treble = bandAverage(spectrum, 80, 512);

    let trebleMotion = map(treble, 0, 1, 0, 45);

    let heatBias = bass * 0.5 + mid * 0.3 + treble * 0.2;

    let colorCenter = color(255, 245, 180);
    let colorMid = color(240, 155, 45);
    let colorEdge = color(120, 85, 55);

    let boost = min(cellW, cellH) * 0.5;
    let drawOrder = [];

    for (let i = 0; i < numCols; i++) {
        for (let j = 0; j < numRows; j++) {
            let cell = cells[i][j];

            if (treble > 0.15) {
                cell.jitterX = lerp(
                    cell.jitterX,
                    random(-trebleMotion * cell.distToCenter, trebleMotion * cell.distToCenter),
                    0.35
                );
                cell.jitterY = lerp(
                    cell.jitterY,
                    random(-trebleMotion * cell.distToCenter, trebleMotion * cell.distToCenter),
                    0.35
                );
            } else {
                cell.jitterX = lerp(cell.jitterX, 0, 0.08);
                cell.jitterY = lerp(cell.jitterY, 0, 0.08);
            }

            let bassX = 0;
            let bassY = 0;

            if (bass > 0.12) {
                let strength = map(bass, 0.12, 1, 0, 35);
                bassX = map(noise(cell.noiseOffsetX, bassTime), 0, 1, -strength, strength);
                bassY = map(noise(cell.noiseOffsetY, bassTime), 0, 1, -strength, strength);
            }

            let x = gridStartX + i * cellW + cellW / 2 + cell.jitterX + bassX;
            let y = j * cellH + cellH / 2 + cell.jitterY + bassY;

            let lightRadius = vol * 1.8;
            let lightAmount = lightRadius < 0.001 ? 0 : max(0, 1 - cell.distToCenter / lightRadius);

            let d = cell.distToCenter;
            let hotColor;

            if (d < 0.5) {
                hotColor = lerpColor(colorCenter, colorMid, d * 2);
            } else {
                hotColor = lerpColor(colorMid, colorEdge, (d - 0.5) * 2);
            }

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
        let jitterW = d.w * random(0.88, 1.12);
        let jitterH = d.h * random(0.88, 1.12);

        paintCell(d.x, d.y, jitterW, jitterH, d.currentColor);
    }

    // OPTIMIZACIÓN DE TEXTURA: Estilo hilado de lino (más rápido y estético que 1500 points aleatorios)
    push();
    stroke(255, 6);
    strokeWeight(1);
    for (let l = 0; l < width; l += 5) {
        line(l, 0, l, height);
    }
    for (let m = 0; m < height; m += 5) {
        line(0, m, width, m);
    }
    pop();
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    initGrid();
}
