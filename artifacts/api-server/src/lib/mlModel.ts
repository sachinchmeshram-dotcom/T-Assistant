/**
 * Gold Swing AI — Pure TypeScript Neural Network
 * 3-layer feedforward net trained on completed trade features.
 * No external ML dependencies — works on any Node.js version.
 *
 * Architecture: 6 → 24 (ReLU) → 12 (ReLU) → 3 (Softmax)
 * Classes: 0 = LONG, 1 = SHORT, 2 = NO_TRADE
 */
import { db, signalsTable } from "@workspace/db";
import { ne } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger.js";

// ── Constants ────────────────────────────────────────────────────────────────
const MODEL_PATH    = "/tmp/gold-ai-model.json";
const FEATURE_COUNT = 6;
const H1            = 24;    // hidden layer 1 size
const H2            = 12;    // hidden layer 2 size
const NUM_CLASSES   = 3;     // LONG / SHORT / NO_TRADE
const MIN_SAMPLES   = 20;
const RETRAIN_EVERY = 50;
const ML_THRESHOLD  = 65;    // % confidence required to drive the signal
const LR            = 0.005; // Adam learning rate
const BETA1         = 0.9;
const BETA2         = 0.999;
const EPS           = 1e-8;
const EPOCHS        = 200;
const BATCH_SIZE    = 32;

// ── Public types ─────────────────────────────────────────────────────────────
export type MLSignal      = "LONG" | "SHORT" | "NO_TRADE";
export type MLModelStatus = "trained" | "training" | "untrained";

export interface MLPrediction {
  signal:      MLSignal;
  confidence:  number;
  pLong:       number;
  pShort:      number;
  pNoTrade:    number;
  modelStatus: MLModelStatus;
  trainedOn:   number;
  accuracy:    number;
  enabled:     boolean;
}

// ── Internal types ───────────────────────────────────────────────────────────
type Matrix = number[][];
type Vector = number[];

interface Weights {
  W1: Matrix; b1: Vector;
  W2: Matrix; b2: Vector;
  W3: Matrix; b3: Vector;
}

interface AdamMoments {
  mW1: Matrix; vW1: Matrix; mb1: Vector; vb1: Vector;
  mW2: Matrix; vW2: Matrix; mb2: Vector; vb2: Vector;
  mW3: Matrix; vW3: Matrix; mb3: Vector; vb3: Vector;
  t: number;
}

interface NetworkState { weights: Weights; moments: AdamMoments; }

// ── Singleton state ──────────────────────────────────────────────────────────
let network:              NetworkState | null = null;
let modelStatus:          MLModelStatus = "untrained";
let trainedOn:            number = 0;
let modelAccuracy:        number = 0;
let trainingInProgress:   boolean = false;
let completedAtLastTrain: number = 0;

// ── Matrix helpers ───────────────────────────────────────────────────────────
function zeros(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}
function zeroVec(len: number): Vector { return new Array(len).fill(0); }

function matMul(A: Matrix, B: Matrix): Matrix {
  const m = A.length, n = B[0].length, k = B.length;
  const C = zeros(m, n);
  for (let i = 0; i < m; i++)
    for (let l = 0; l < k; l++)
      if (A[i][l] !== 0)
        for (let j = 0; j < n; j++)
          C[i][j] += A[i][l] * B[l][j];
  return C;
}

function transpose(A: Matrix): Matrix {
  const rows = A.length, cols = A[0].length;
  const T = zeros(cols, rows);
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      T[j][i] = A[i][j];
  return T;
}

function addBias(Z: Matrix, b: Vector): Matrix {
  return Z.map(row => row.map((v, j) => v + b[j]));
}

function relu(Z: Matrix): Matrix {
  return Z.map(row => row.map(v => Math.max(0, v)));
}

function reluGrad(Z: Matrix): Matrix {
  return Z.map(row => row.map(v => v > 0 ? 1 : 0));
}

function softmax(Z: Matrix): Matrix {
  return Z.map(row => {
    const maxV = Math.max(...row);
    const exps = row.map(v => Math.exp(v - maxV));
    const s = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / s);
  });
}

function hadamard(A: Matrix, B: Matrix): Matrix {
  return A.map((row, i) => row.map((v, j) => v * B[i][j]));
}

function sumCols(A: Matrix): Vector {
  const cols = A[0].length;
  const r = zeroVec(cols);
  for (const row of A) for (let j = 0; j < cols; j++) r[j] += row[j];
  return r;
}

function scaleMat(A: Matrix, s: number): Matrix {
  return A.map(row => row.map(v => v * s));
}

function addMat(A: Matrix, B: Matrix): Matrix {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

function subMat(A: Matrix, B: Matrix): Matrix {
  return A.map((row, i) => row.map((v, j) => v - B[i][j]));
}

// ── Weight initialisation (He) ───────────────────────────────────────────────
function heMatrix(rows: number, cols: number): Matrix {
  const std = Math.sqrt(2 / rows);
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() * 2 - 1) * std)
  );
}

function initWeights(): Weights {
  return {
    W1: heMatrix(FEATURE_COUNT, H1), b1: zeroVec(H1),
    W2: heMatrix(H1, H2),           b2: zeroVec(H2),
    W3: heMatrix(H2, NUM_CLASSES),  b3: zeroVec(NUM_CLASSES),
  };
}

function initMoments(): AdamMoments {
  return {
    mW1: zeros(FEATURE_COUNT, H1), vW1: zeros(FEATURE_COUNT, H1),
    mb1: zeroVec(H1),              vb1: zeroVec(H1),
    mW2: zeros(H1, H2),            vW2: zeros(H1, H2),
    mb2: zeroVec(H2),              vb2: zeroVec(H2),
    mW3: zeros(H2, NUM_CLASSES),   vW3: zeros(H2, NUM_CLASSES),
    mb3: zeroVec(NUM_CLASSES),     vb3: zeroVec(NUM_CLASSES),
    t: 0,
  };
}

// ── Adam update helpers ───────────────────────────────────────────────────────
function adamMat(
  W: Matrix, dW: Matrix,
  m: Matrix, v: Matrix,
  t: number
): { W: Matrix; m: Matrix; v: Matrix } {
  const newM = addMat(scaleMat(m, BETA1), scaleMat(dW, 1 - BETA1));
  const newV = addMat(
    scaleMat(v, BETA2),
    dW.map(row => row.map(g => g * g * (1 - BETA2)))
  );
  const bc1 = 1 - Math.pow(BETA1, t);
  const bc2 = 1 - Math.pow(BETA2, t);
  const update = newM.map((row, i) =>
    row.map((mv, j) => LR * (mv / bc1) / (Math.sqrt(newV[i][j] / bc2) + EPS))
  );
  return { W: subMat(W, update), m: newM, v: newV };
}

function adamVec(
  b: Vector, db: Vector,
  m: Vector, v: Vector,
  t: number
): { b: Vector; m: Vector; v: Vector } {
  const newM = m.map((mv, i) => BETA1 * mv + (1 - BETA1) * db[i]);
  const newV = v.map((vv, i) => BETA2 * vv + (1 - BETA2) * db[i] * db[i]);
  const bc1 = 1 - Math.pow(BETA1, t);
  const bc2 = 1 - Math.pow(BETA2, t);
  const nb = b.map((bv, i) => bv - LR * (newM[i] / bc1) / (Math.sqrt(newV[i] / bc2) + EPS));
  return { b: nb, m: newM, v: newV };
}

// ── Forward / backward ────────────────────────────────────────────────────────
function forward(X: Matrix, W: Weights) {
  const Z1 = addBias(matMul(X, W.W1), W.b1);
  const A1 = relu(Z1);
  const Z2 = addBias(matMul(A1, W.W2), W.b2);
  const A2 = relu(Z2);
  const Z3 = addBias(matMul(A2, W.W3), W.b3);
  const A3 = softmax(Z3);
  return { Z1, A1, Z2, A2, A3 };
}

function backward(
  X: Matrix, Y: Matrix,
  cache: ReturnType<typeof forward>,
  W: Weights
) {
  const m = X.length;
  const { Z1, A1, Z2, A2, A3 } = cache;

  const dZ3 = subMat(A3, Y);
  const dW3 = scaleMat(matMul(transpose(A2), dZ3), 1 / m);
  const db3 = sumCols(dZ3).map(v => v / m);

  const dA2 = matMul(dZ3, transpose(W.W3));
  const dZ2 = hadamard(dA2, reluGrad(Z2));
  const dW2 = scaleMat(matMul(transpose(A1), dZ2), 1 / m);
  const db2 = sumCols(dZ2).map(v => v / m);

  const dA1 = matMul(dZ2, transpose(W.W2));
  const dZ1 = hadamard(dA1, reluGrad(Z1));
  const dW1 = scaleMat(matMul(transpose(X), dZ1), 1 / m);
  const db1 = sumCols(dZ1).map(v => v / m);

  return { dW1, db1, dW2, db2, dW3, db3 };
}

function crossEntropyLoss(A3: Matrix, Y: Matrix): number {
  const m = A3.length;
  let loss = 0;
  for (let i = 0; i < m; i++)
    for (let j = 0; j < NUM_CLASSES; j++)
      if (Y[i][j] === 1)
        loss -= Math.log(Math.max(A3[i][j], 1e-9));
  return loss / m;
}

function accuracy(A3: Matrix, Y: Matrix): number {
  let correct = 0;
  for (let i = 0; i < A3.length; i++) {
    const pred  = A3[i].indexOf(Math.max(...A3[i]));
    const label = Y[i].indexOf(1);
    if (pred === label) correct++;
  }
  return correct / A3.length;
}

// ── Shuffle helper ────────────────────────────────────────────────────────────
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Feature engineering ──────────────────────────────────────────────────────
export function featurize(row: {
  marketStructure?: string | null;
  bosPresent?:      boolean | null;
  liquiditySweep?:  boolean | null;
  inOrderBlock?:    boolean | null;
  smcScore?:        number  | null;
  confidence:       number;
}): number[] {
  const structure =
    row.marketStructure === "UPTREND"   ?  1 :
    row.marketStructure === "DOWNTREND" ? -1 : 0;
  return [
    structure,
    row.bosPresent     ? 1 : 0,
    row.liquiditySweep ? 1 : 0,
    row.inOrderBlock   ? 1 : 0,
    (row.smcScore ?? 0) / 100,
    row.confidence      / 100,
  ];
}

// ── Training data from DB ────────────────────────────────────────────────────
interface Sample { features: number[]; label: number; }

async function getTrainingSamples(): Promise<Sample[]> {
  const rows = await db.select().from(signalsTable).where(ne(signalsTable.tradeStatus, "RUNNING"));
  const samples: Sample[] = [];
  for (const r of rows) {
    if (r.signal !== "LONG" && r.signal !== "SHORT") continue;
    if (r.tradeStatus !== "TARGET_HIT" && r.tradeStatus !== "STOP_HIT") continue;
    const features = featurize({
      marketStructure: r.marketStructure,
      bosPresent:      r.bosPresent,
      liquiditySweep:  r.liquiditySweep,
      inOrderBlock:    r.inOrderBlock,
      smcScore:        r.smcScore,
      confidence:      r.confidence,
    });
    const label = r.tradeStatus === "TARGET_HIT"
      ? (r.signal === "LONG" ? 0 : 1)
      : 2;
    samples.push({ features, label });
  }
  return samples;
}

// ── Core training loop ───────────────────────────────────────────────────────
async function trainFromDB(): Promise<void> {
  if (trainingInProgress) return;
  trainingInProgress = true;
  modelStatus = "training";

  try {
    const allSamples = await getTrainingSamples();
    if (allSamples.length < MIN_SAMPLES) {
      logger.info({ count: allSamples.length, min: MIN_SAMPLES }, "ML: not enough samples");
      modelStatus = "untrained";
      return;
    }

    logger.info({ samples: allSamples.length }, "ML: starting training");

    // 80/20 train/val split
    const shuffled  = shuffle(allSamples);
    const splitIdx  = Math.floor(shuffled.length * 0.8);
    const trainData = shuffled.slice(0, splitIdx);
    const valData   = shuffled.slice(splitIdx);

    let W = initWeights();
    let moments = initMoments();
    let bestValAcc = 0;
    let bestW: Weights = W;

    const toXY = (samples: Sample[]) => {
      const X: Matrix = samples.map(s => s.features);
      const Y: Matrix = samples.map(s => {
        const y = [0, 0, 0]; y[s.label] = 1; return y;
      });
      return { X, Y };
    };

    for (let epoch = 0; epoch < EPOCHS; epoch++) {
      const batches = shuffle(trainData);
      for (let start = 0; start < batches.length; start += BATCH_SIZE) {
        const batch = batches.slice(start, start + BATCH_SIZE);
        const { X, Y } = toXY(batch);
        moments.t += 1;

        const cache = forward(X, W);
        const grads = backward(X, Y, cache, W);

        // Adam update for each weight matrix
        const r1 = adamMat(W.W1, grads.dW1, moments.mW1, moments.vW1, moments.t);
        W.W1 = r1.W; moments.mW1 = r1.m; moments.vW1 = r1.v;
        const r1b = adamVec(W.b1, grads.db1, moments.mb1, moments.vb1, moments.t);
        W.b1 = r1b.b; moments.mb1 = r1b.m; moments.vb1 = r1b.v;

        const r2 = adamMat(W.W2, grads.dW2, moments.mW2, moments.vW2, moments.t);
        W.W2 = r2.W; moments.mW2 = r2.m; moments.vW2 = r2.v;
        const r2b = adamVec(W.b2, grads.db2, moments.mb2, moments.vb2, moments.t);
        W.b2 = r2b.b; moments.mb2 = r2b.m; moments.vb2 = r2b.v;

        const r3 = adamMat(W.W3, grads.dW3, moments.mW3, moments.vW3, moments.t);
        W.W3 = r3.W; moments.mW3 = r3.m; moments.vW3 = r3.v;
        const r3b = adamVec(W.b3, grads.db3, moments.mb3, moments.vb3, moments.t);
        W.b3 = r3b.b; moments.mb3 = r3b.m; moments.vb3 = r3b.v;
      }

      if ((epoch + 1) % 50 === 0) {
        const { X: Xv, Y: Yv } = toXY(valData.length > 0 ? valData : trainData);
        const { A3 } = forward(Xv, W);
        const valAcc = accuracy(A3, Yv);
        const { X: Xt, Y: Yt } = toXY(trainData);
        const { A3: At } = forward(Xt, W);
        const trainLoss = crossEntropyLoss(At, Yt);
        logger.info({
          epoch: epoch + 1,
          loss: +trainLoss.toFixed(4),
          valAcc: +(valAcc * 100).toFixed(1) + "%",
        }, "ML epoch");
        if (valAcc > bestValAcc) { bestValAcc = valAcc; bestW = JSON.parse(JSON.stringify(W)); }
      }
    }

    // Use best weights
    const { X: Xf, Y: Yf } = toXY(valData.length > 0 ? valData : trainData);
    const { A3: Af } = forward(Xf, bestW);
    const finalAcc = accuracy(Af, Yf);

    network              = { weights: bestW, moments };
    modelStatus          = "trained";
    trainedOn            = allSamples.length;
    modelAccuracy        = Math.round(finalAcc * 100);
    completedAtLastTrain = allSamples.length;

    await saveNetwork();
    logger.info({ trainedOn, accuracy: modelAccuracy }, "ML: training complete ✓");
  } catch (err) {
    logger.error({ err }, "ML: training error");
    modelStatus = "untrained";
  } finally {
    trainingInProgress = false;
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────
async function saveNetwork(): Promise<void> {
  try {
    fs.writeFileSync(MODEL_PATH, JSON.stringify({ weights: network!.weights, accuracy: modelAccuracy, trainedOn }));
    logger.info({ path: MODEL_PATH }, "ML: model saved");
  } catch (err) {
    logger.warn({ err }, "ML: save failed");
  }
}

async function loadNetwork(): Promise<boolean> {
  if (!fs.existsSync(MODEL_PATH)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(MODEL_PATH, "utf8"));
    network       = { weights: saved.weights, moments: initMoments() };
    modelAccuracy = saved.accuracy ?? 0;
    const samples = await getTrainingSamples();
    trainedOn            = saved.trainedOn ?? samples.length;
    completedAtLastTrain = samples.length;
    modelStatus          = "trained";
    logger.info({ trainedOn, accuracy: modelAccuracy }, "ML: model loaded from disk");
    return true;
  } catch (err) {
    logger.warn({ err }, "ML: load failed — will retrain");
    return false;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function initML(): Promise<void> {
  logger.info("ML: initialising neural network");
  const loaded = await loadNetwork();
  if (!loaded) await trainFromDB();
}

export async function retrainIfNeeded(): Promise<void> {
  if (trainingInProgress) return;
  try {
    const samples = await getTrainingSamples();
    const newSince = samples.length - completedAtLastTrain;
    if (
      samples.length >= MIN_SAMPLES &&
      (newSince >= RETRAIN_EVERY || (modelStatus === "untrained" && samples.length >= MIN_SAMPLES))
    ) {
      logger.info({ samples: samples.length, newSince }, "ML: retraining triggered");
      trainFromDB().catch(err => logger.error({ err }, "ML: retrain error"));
    }
  } catch (err) {
    logger.warn({ err }, "ML: retrainIfNeeded error");
  }
}

export function predict(features: number[]): MLPrediction {
  const fallback: MLPrediction = {
    signal: "NO_TRADE", confidence: 0,
    pLong: 34, pShort: 33, pNoTrade: 33,
    modelStatus: trainingInProgress ? "training" : modelStatus,
    trainedOn, accuracy: modelAccuracy, enabled: false,
  };

  if (!network || modelStatus !== "trained") return fallback;

  try {
    const X = [features];
    const { A3 } = forward(X, network.weights);
    const probs = A3[0];

    const pLong    = Math.round(probs[0] * 100);
    const pShort   = Math.round(probs[1] * 100);
    const pNoTrade = Math.round(probs[2] * 100);
    const maxP     = Math.max(...probs);
    const idx      = probs.indexOf(maxP);

    const signal: MLSignal = idx === 0 ? "LONG" : idx === 1 ? "SHORT" : "NO_TRADE";
    const confidence = Math.round(maxP * 100);

    return {
      signal, confidence, pLong, pShort, pNoTrade,
      modelStatus: "trained",
      trainedOn, accuracy: modelAccuracy,
      enabled: confidence >= ML_THRESHOLD,
    };
  } catch {
    return fallback;
  }
}

export function getMLStatus(): { mlModelStatus: MLModelStatus; mlTrainedOn: number; mlAccuracy: number } {
  return {
    mlModelStatus: trainingInProgress ? "training" : modelStatus,
    mlTrainedOn:   trainedOn,
    mlAccuracy:    modelAccuracy,
  };
}
