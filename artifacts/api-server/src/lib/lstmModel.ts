/**
 * Gold Swing AI — LSTM Time-Series Model
 * Predicts LONG / SHORT / NO_TRADE from the last 50 OHLC 1m candles.
 *
 * Architecture: [50, 5] → LSTM(32) → Dense(16, ReLU) → Dense(3, Softmax)
 * Pure TypeScript — zero native dependencies, works on any Node.js version.
 * Training uses full BPTT with Adam optimizer and gradient clipping.
 *
 * Features per candle (normalised relative to first candle's close):
 *   [0] open_rel   = (open  - ref) / ref
 *   [1] high_rel   = (high  - ref) / ref
 *   [2] low_rel    = (low   - ref) / ref
 *   [3] close_rel  = (close - ref) / ref
 *   [4] range_rel  = (high  - low) / ref   ← intra-bar volatility
 */
import * as fs   from "fs";
import { logger } from "./logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────
export const SEQ_LEN  = 50;   // candles in each sequence
const FEAT_SZ         = 5;    // features per candle
const HIDDEN          = 32;   // LSTM hidden state size
const D1              = 16;   // Dense layer 1 size
const NCLS            = 3;    // output classes
const COMB            = HIDDEN + FEAT_SZ; // 37 — LSTM gate input size

const MODEL_PATH   = "/tmp/lstm-model.json";
const TRAIN_PATH   = "/tmp/lstm-training.json";

const LR           = 0.003;
const BETA1        = 0.9;
const BETA2        = 0.999;
const EPS_ADAM     = 1e-8;
const EPOCHS       = 100;
const BATCH        = 8;
const CLIP         = 5.0;    // gradient norm clipping
const MIN_SAMPLES  = 15;
const RETRAIN_EVERY = 30;
const LSTM_THRESHOLD = 60;   // % confidence to enable LSTM signal

// ── Public types ──────────────────────────────────────────────────────────────
export type MLModelStatus = "trained" | "training" | "untrained";
export type MLSignal      = "LONG" | "SHORT" | "NO_TRADE";

export interface LSTMPrediction {
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

export interface LSTMCandle { open: number; high: number; low: number; close: number; }

// ── Internal types ────────────────────────────────────────────────────────────
interface Weights {
  // LSTM gates — each [HIDDEN, COMB]
  Wf: number[][]; bf: number[];
  Wi: number[][]; bi: number[];
  Wg: number[][]; bg: number[];
  Wo: number[][]; bo: number[];
  // Dense
  W1: number[][]; b1: number[];  // [D1, HIDDEN]
  W2: number[][]; b2: number[];  // [NCLS, D1]
}

interface AdamState {
  mWf: number[][]; vWf: number[][];  mbf: number[]; vbf: number[];
  mWi: number[][]; vWi: number[][];  mbi: number[]; vbi: number[];
  mWg: number[][]; vWg: number[][];  mbg: number[]; vbg: number[];
  mWo: number[][]; vWo: number[][];  mbo: number[]; vbo: number[];
  mW1: number[][]; vW1: number[][];  mb1: number[]; vb1: number[];
  mW2: number[][]; vW2: number[][];  mb2: number[]; vb2: number[];
  t: number;
}

interface TrainRecord { sequence: number[][]; label: 0 | 1 | 2; }

// ── Singleton state ───────────────────────────────────────────────────────────
let weights:   Weights | null = null;
let adamState: AdamState | null = null;
let modelStatus:  MLModelStatus = "untrained";
let trainedOn:    number = 0;
let modelAccuracy:number = 0;
let training = false;
let closedAtLastTrain = 0;

// Sequence capture — hold the last 50 raw candles from signal generation
let lastRawSequence: LSTMCandle[] | null = null;
const captureBuffer = new Map<number, LSTMCandle[]>(); // tradeId → candles

// ── Math helpers ──────────────────────────────────────────────────────────────
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function z2D(r: number, c: number): number[][] {
  return Array.from({ length: r }, () => new Array(c).fill(0));
}
function zVec(n: number): number[] { return new Array(n).fill(0); }

function matVec(W: number[][], x: number[]): number[] {
  return W.map(row => row.reduce((s, v, j) => s + v * x[j], 0));
}
function matVecT(W: number[][], x: number[]): number[] {
  // W.T @ x  where W = [m, n], x = [m], result = [n]
  const n = W[0].length, result = zVec(n);
  for (let i = 0; i < W.length; i++)
    for (let j = 0; j < n; j++)
      result[j] += W[i][j] * x[i];
  return result;
}
function vecAdd(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + b[i]);
}
function outerAdd(M: number[][], a: number[], b: number[]): void {
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      M[i][j] += a[i] * b[j];
}
function softmax(z: number[]): number[] {
  const mx = Math.max(...z);
  const ex = z.map(v => Math.exp(v - mx));
  const s  = ex.reduce((a, b) => a + b, 0);
  return ex.map(e => e / s);
}
function clipGrad(g: number): number {
  return Math.max(-CLIP, Math.min(CLIP, g));
}
function clipMat(M: number[][]): number[][] {
  return M.map(row => row.map(clipGrad));
}
function clipVec(v: number[]): number[] { return v.map(clipGrad); }

// ── Weight initialisation (Xavier) ────────────────────────────────────────────
function xavier(rows: number, cols: number): number[][] {
  const std = Math.sqrt(2 / (rows + cols));
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() * 2 - 1) * std)
  );
}

function initWeights(): Weights {
  // Slightly smaller init for LSTM gates
  const lstmStd = Math.sqrt(1 / COMB);
  const lstmInit = (r: number, c: number) =>
    Array.from({ length: r }, () =>
      Array.from({ length: c }, () => (Math.random() * 2 - 1) * lstmStd)
    );
  return {
    Wf: lstmInit(HIDDEN, COMB), bf: zVec(HIDDEN).map(() => 1.0),  // forget bias=1 (common practice)
    Wi: lstmInit(HIDDEN, COMB), bi: zVec(HIDDEN),
    Wg: lstmInit(HIDDEN, COMB), bg: zVec(HIDDEN),
    Wo: lstmInit(HIDDEN, COMB), bo: zVec(HIDDEN),
    W1: xavier(D1, HIDDEN),    b1: zVec(D1),
    W2: xavier(NCLS, D1),      b2: zVec(NCLS),
  };
}

function initAdam(): AdamState {
  return {
    mWf: z2D(HIDDEN,COMB), vWf: z2D(HIDDEN,COMB), mbf: zVec(HIDDEN), vbf: zVec(HIDDEN),
    mWi: z2D(HIDDEN,COMB), vWi: z2D(HIDDEN,COMB), mbi: zVec(HIDDEN), vbi: zVec(HIDDEN),
    mWg: z2D(HIDDEN,COMB), vWg: z2D(HIDDEN,COMB), mbg: zVec(HIDDEN), vbg: zVec(HIDDEN),
    mWo: z2D(HIDDEN,COMB), vWo: z2D(HIDDEN,COMB), mbo: zVec(HIDDEN), vbo: zVec(HIDDEN),
    mW1: z2D(D1,HIDDEN),   vW1: z2D(D1,HIDDEN),   mb1: zVec(D1),     vb1: zVec(D1),
    mW2: z2D(NCLS,D1),     vW2: z2D(NCLS,D1),     mb2: zVec(NCLS),   vb2: zVec(NCLS),
    t: 0,
  };
}

// ── Adam update helpers ───────────────────────────────────────────────────────
function adamMat(
  W: number[][], dW: number[][],
  m: number[][], v: number[][],
  t: number
): void {
  const bc1 = 1 - BETA1 ** t, bc2 = 1 - BETA2 ** t;
  for (let i = 0; i < W.length; i++)
    for (let j = 0; j < W[0].length; j++) {
      m[i][j] = BETA1 * m[i][j] + (1 - BETA1) * dW[i][j];
      v[i][j] = BETA2 * v[i][j] + (1 - BETA2) * dW[i][j] ** 2;
      W[i][j] -= LR * (m[i][j] / bc1) / (Math.sqrt(v[i][j] / bc2) + EPS_ADAM);
    }
}
function adamVec(
  b: number[], db: number[],
  m: number[], v: number[],
  t: number
): void {
  const bc1 = 1 - BETA1 ** t, bc2 = 1 - BETA2 ** t;
  for (let i = 0; i < b.length; i++) {
    m[i] = BETA1 * m[i] + (1 - BETA1) * db[i];
    v[i] = BETA2 * v[i] + (1 - BETA2) * db[i] ** 2;
    b[i] -= LR * (m[i] / bc1) / (Math.sqrt(v[i] / bc2) + EPS_ADAM);
  }
}

// ── Feature normalisation (per-sequence, shift-invariant) ─────────────────────
function normalise(candles: LSTMCandle[]): number[][] {
  const ref = candles[0].close || 1;
  return candles.map(c => [
    (c.open  - ref) / ref,
    (c.high  - ref) / ref,
    (c.low   - ref) / ref,
    (c.close - ref) / ref,
    (c.high  - c.low) / ref,  // intra-bar range
  ]);
}

// ── LSTM forward + BPTT ───────────────────────────────────────────────────────
interface StepCache {
  concat: number[];
  c_prev: number[];
  c: number[];
  f: number[];
  i: number[];
  g: number[];
  o: number[];
}

function forwardAndBPTT(
  seq: number[][],   // [SEQ_LEN, FEAT_SZ] — already normalised
  label: 0 | 1 | 2,
  W: Weights
): {
  loss: number;
  dWf: number[][]; dWi: number[][]; dWg: number[][]; dWo: number[][];
  dbf: number[];   dbi: number[];   dbg: number[];   dbo: number[];
  dW1: number[][]; db1: number[];
  dW2: number[][]; db2: number[];
} {
  // ── Forward pass ─────────────────────────────────────────────────────────
  let h = zVec(HIDDEN), c = zVec(HIDDEN);
  const steps: StepCache[] = [];

  for (const x of seq) {
    const concat = [...h, ...x];
    const f = vecAdd(matVec(W.Wf, concat), W.bf).map(sigmoid);
    const i = vecAdd(matVec(W.Wi, concat), W.bi).map(sigmoid);
    const g = vecAdd(matVec(W.Wg, concat), W.bg).map(Math.tanh);
    const o = vecAdd(matVec(W.Wo, concat), W.bo).map(sigmoid);
    const c_prev = [...c];
    c = c.map((cv, k) => f[k] * cv + i[k] * g[k]);
    h = o.map((ov, k) => ov * Math.tanh(c[k]));
    steps.push({ concat, c_prev, c: [...c], f, i, g, o });
  }

  // Dense forward
  const z1 = vecAdd(matVec(W.W1, h), W.b1);
  const a1 = z1.map(v => Math.max(0, v));
  const z2 = vecAdd(matVec(W.W2, a1), W.b2);
  const a2 = softmax(z2);

  const loss = -Math.log(Math.max(a2[label], 1e-9));

  // ── Backward through Dense ────────────────────────────────────────────────
  const dz2 = a2.map((v, k) => k === label ? v - 1 : v);
  const dW2 = z2D(NCLS, D1);
  outerAdd(dW2, dz2, a1);
  const db2 = [...dz2];

  const da1  = matVecT(W.W2, dz2);
  const dz1  = da1.map((v, k) => z1[k] > 0 ? v : 0);
  const dW1  = z2D(D1, HIDDEN);
  outerAdd(dW1, dz1, h);
  const db1  = [...dz1];

  let dh = matVecT(W.W1, dz1);

  // ── BPTT through LSTM ─────────────────────────────────────────────────────
  let dc = zVec(HIDDEN);

  const dWf = z2D(HIDDEN, COMB), dWi = z2D(HIDDEN, COMB);
  const dWg = z2D(HIDDEN, COMB), dWo = z2D(HIDDEN, COMB);
  const dbf = zVec(HIDDEN), dbi = zVec(HIDDEN);
  const dbg = zVec(HIDDEN), dbo = zVec(HIDDEN);

  for (let t = steps.length - 1; t >= 0; t--) {
    const { concat, c_prev, c, f, i, g, o } = steps[t];

    // dh → dc via h = o * tanh(c)
    const tanh_c = c.map(Math.tanh);
    const do_    = dh.map((v, k) => v * tanh_c[k]);
    dc            = dc.map((v, k) => v + dh[k] * o[k] * (1 - tanh_c[k] ** 2));

    // dc → gate gradients
    const df = dc.map((v, k) => v * c_prev[k]);
    const di = dc.map((v, k) => v * g[k]);
    const dg = dc.map((v, k) => v * i[k]);

    // pass dc to previous step
    dc = dc.map((v, k) => v * f[k]);

    // Sigmoid / tanh derivatives
    const df_r = df.map((v, k) => v * f[k] * (1 - f[k]));
    const di_r = di.map((v, k) => v * i[k] * (1 - i[k]));
    const dg_r = dg.map((v, k) => v * (1 - g[k] ** 2));
    const do_r = do_.map((v, k) => v * o[k] * (1 - o[k]));

    // Weight gradients
    outerAdd(dWf, df_r, concat); for (let k=0;k<HIDDEN;k++) dbf[k] += df_r[k];
    outerAdd(dWi, di_r, concat); for (let k=0;k<HIDDEN;k++) dbi[k] += di_r[k];
    outerAdd(dWg, dg_r, concat); for (let k=0;k<HIDDEN;k++) dbg[k] += dg_r[k];
    outerAdd(dWo, do_r, concat); for (let k=0;k<HIDDEN;k++) dbo[k] += do_r[k];

    // Gradient to h_prev (first HIDDEN elements of dconcat)
    const dcf = matVecT(W.Wf, df_r);
    const dci = matVecT(W.Wi, di_r);
    const dcg = matVecT(W.Wg, dg_r);
    const dco = matVecT(W.Wo, do_r);

    dh = dh.map((_, k) => dcf[k] + dci[k] + dcg[k] + dco[k]); // h_prev grad
  }

  return {
    loss,
    dWf: clipMat(dWf), dWi: clipMat(dWi), dWg: clipMat(dWg), dWo: clipMat(dWo),
    dbf: clipVec(dbf), dbi: clipVec(dbi), dbg: clipVec(dbg), dbo: clipVec(dbo),
    dW1: clipMat(dW1), db1: clipVec(db1),
    dW2: clipMat(dW2), db2: clipVec(db2),
  };
}

// ── Training loop ─────────────────────────────────────────────────────────────
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function computeAccuracy(records: TrainRecord[], W: Weights): number {
  let correct = 0;
  for (const r of records) {
    let h = zVec(HIDDEN), c = zVec(HIDDEN);
    for (const x of r.sequence) {
      const concat = [...h, ...x];
      const f = vecAdd(matVec(W.Wf, concat), W.bf).map(sigmoid);
      const i = vecAdd(matVec(W.Wi, concat), W.bi).map(sigmoid);
      const g = vecAdd(matVec(W.Wg, concat), W.bg).map(Math.tanh);
      const o = vecAdd(matVec(W.Wo, concat), W.bo).map(sigmoid);
      c = c.map((cv, k) => f[k] * cv + i[k] * g[k]);
      h = o.map((ov, k) => ov * Math.tanh(c[k]));
    }
    const z1 = vecAdd(matVec(W.W1, h), W.b1);
    const a1 = z1.map(v => Math.max(0, v));
    const a2 = softmax(vecAdd(matVec(W.W2, a1), W.b2));
    if (a2.indexOf(Math.max(...a2)) === r.label) correct++;
  }
  return correct / records.length;
}

async function trainFromRecords(): Promise<void> {
  if (training) return;
  training = true;
  modelStatus = "training";

  try {
    const all = loadTrainingData();
    if (all.length < MIN_SAMPLES) {
      logger.info({ count: all.length, min: MIN_SAMPLES }, "LSTM: not enough samples");
      modelStatus = "untrained";
      return;
    }

    logger.info({ samples: all.length }, "LSTM: training started");

    const shuffled = shuffle(all);
    const splitIdx = Math.floor(shuffled.length * 0.8);
    const trainSet = shuffled.slice(0, splitIdx);
    const valSet   = shuffled.slice(splitIdx);

    const W  = weights ?? initWeights();
    const as = adamState ?? initAdam();

    let bestValAcc = 0;
    let bestW = JSON.parse(JSON.stringify(W)) as Weights;

    for (let ep = 0; ep < EPOCHS; ep++) {
      const batches = shuffle(trainSet);
      for (let start = 0; start < batches.length; start += BATCH) {
        const batch = batches.slice(start, start + BATCH);
        as.t++;

        // Accumulate gradients over batch
        const acc = {
          dWf: z2D(HIDDEN,COMB), dWi: z2D(HIDDEN,COMB),
          dWg: z2D(HIDDEN,COMB), dWo: z2D(HIDDEN,COMB),
          dbf: zVec(HIDDEN), dbi: zVec(HIDDEN),
          dbg: zVec(HIDDEN), dbo: zVec(HIDDEN),
          dW1: z2D(D1,HIDDEN), db1: zVec(D1),
          dW2: z2D(NCLS,D1),  db2: zVec(NCLS),
        };
        let batchLoss = 0;

        for (const rec of batch) {
          const g = forwardAndBPTT(rec.sequence, rec.label, W);
          batchLoss += g.loss;
          // Accumulate
          for (let i=0;i<HIDDEN;i++) for (let j=0;j<COMB;j++) {
            acc.dWf[i][j] += g.dWf[i][j] / BATCH;
            acc.dWi[i][j] += g.dWi[i][j] / BATCH;
            acc.dWg[i][j] += g.dWg[i][j] / BATCH;
            acc.dWo[i][j] += g.dWo[i][j] / BATCH;
          }
          for (let i=0;i<D1;i++) for (let j=0;j<HIDDEN;j++) acc.dW1[i][j] += g.dW1[i][j] / BATCH;
          for (let i=0;i<NCLS;i++) for (let j=0;j<D1;j++) acc.dW2[i][j] += g.dW2[i][j] / BATCH;
          for (let k=0;k<HIDDEN;k++) { acc.dbf[k]+=g.dbf[k]/BATCH; acc.dbi[k]+=g.dbi[k]/BATCH;
            acc.dbg[k]+=g.dbg[k]/BATCH; acc.dbo[k]+=g.dbo[k]/BATCH; }
          for (let k=0;k<D1;k++) acc.db1[k] += g.db1[k] / BATCH;
          for (let k=0;k<NCLS;k++) acc.db2[k] += g.db2[k] / BATCH;
        }

        // Adam updates
        adamMat(W.Wf, acc.dWf, as.mWf, as.vWf, as.t);
        adamMat(W.Wi, acc.dWi, as.mWi, as.vWi, as.t);
        adamMat(W.Wg, acc.dWg, as.mWg, as.vWg, as.t);
        adamMat(W.Wo, acc.dWo, as.mWo, as.vWo, as.t);
        adamVec(W.bf, acc.dbf, as.mbf, as.vbf, as.t);
        adamVec(W.bi, acc.dbi, as.mbi, as.vbi, as.t);
        adamVec(W.bg, acc.dbg, as.mbg, as.vbg, as.t);
        adamVec(W.bo, acc.dbo, as.mbo, as.vbo, as.t);
        adamMat(W.W1, acc.dW1, as.mW1, as.vW1, as.t);
        adamVec(W.b1, acc.db1, as.mb1, as.vb1, as.t);
        adamMat(W.W2, acc.dW2, as.mW2, as.vW2, as.t);
        adamVec(W.b2, acc.db2, as.mb2, as.vb2, as.t);
      }

      if ((ep + 1) % 25 === 0) {
        const evalSet = valSet.length > 0 ? valSet : trainSet;
        const vacc = computeAccuracy(evalSet, W);
        logger.info({ epoch: ep+1, valAcc: +(vacc*100).toFixed(1) + "%" }, "LSTM epoch");
        if (vacc > bestValAcc) { bestValAcc = vacc; bestW = JSON.parse(JSON.stringify(W)); }
      }
    }

    // Final accuracy on val set
    const evalSet = valSet.length > 0 ? valSet : trainSet;
    const finalAcc = computeAccuracy(evalSet, bestW);

    weights       = bestW;
    adamState     = as;
    modelStatus   = "trained";
    trainedOn     = all.length;
    modelAccuracy = Math.round(finalAcc * 100);
    closedAtLastTrain = all.length;

    saveModel();
    logger.info({ trainedOn, accuracy: modelAccuracy }, "LSTM: training complete ✓");

  } catch (err) {
    logger.error({ err }, "LSTM: training error");
    modelStatus = weights ? "trained" : "untrained";
  } finally {
    training = false;
  }
}

// ── Training data persistence ─────────────────────────────────────────────────
const MAX_RECORDS = 500;

function loadTrainingData(): TrainRecord[] {
  try {
    if (!fs.existsSync(TRAIN_PATH)) return [];
    return JSON.parse(fs.readFileSync(TRAIN_PATH, "utf8")) as TrainRecord[];
  } catch { return []; }
}

function saveTrainingData(records: TrainRecord[]): void {
  try {
    const trimmed = records.slice(-MAX_RECORDS);
    fs.writeFileSync(TRAIN_PATH, JSON.stringify(trimmed));
  } catch (err) { logger.warn({ err }, "LSTM: failed to save training data"); }
}

function appendTrainingRecord(seq: LSTMCandle[], label: 0 | 1 | 2): void {
  const sequence = normalise(seq);
  const existing = loadTrainingData();
  existing.push({ sequence, label });
  saveTrainingData(existing);
}

// ── Model persistence ─────────────────────────────────────────────────────────
function saveModel(): void {
  try {
    fs.writeFileSync(MODEL_PATH, JSON.stringify({ weights, accuracy: modelAccuracy, trainedOn }));
    logger.info({ path: MODEL_PATH }, "LSTM: model saved");
  } catch (err) { logger.warn({ err }, "LSTM: save failed"); }
}

function loadModel(): boolean {
  try {
    if (!fs.existsSync(MODEL_PATH)) return false;
    const saved = JSON.parse(fs.readFileSync(MODEL_PATH, "utf8"));
    weights       = saved.weights;
    modelAccuracy = saved.accuracy ?? 0;
    trainedOn     = saved.trainedOn ?? 0;
    const all = loadTrainingData();
    closedAtLastTrain = all.length;
    modelStatus   = "trained";
    logger.info({ trainedOn, accuracy: modelAccuracy }, "LSTM: model loaded from disk");
    return true;
  } catch (err) {
    logger.warn({ err }, "LSTM: load failed");
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Call on server start — loads saved model or trains from existing records. */
export async function initLSTM(): Promise<void> {
  logger.info("LSTM: initialising time-series model");
  if (!loadModel()) {
    // try training from any existing records
    const records = loadTrainingData();
    if (records.length >= MIN_SAMPLES) {
      trainFromRecords().catch(err => logger.error({ err }, "LSTM init train failed"));
    } else {
      logger.info({ records: records.length, need: MIN_SAMPLES }, "LSTM: cold start — collecting data");
    }
  }
}

/**
 * Predict next move from the last 50 candles.
 * Also stores the raw candles so they can be captured when a trade opens.
 */
export function predictLSTM(candles: LSTMCandle[]): LSTMPrediction {
  const seq50 = candles.slice(-SEQ_LEN);
  if (seq50.length === SEQ_LEN) lastRawSequence = seq50;

  const fallback: LSTMPrediction = {
    signal: "NO_TRADE", confidence: 0,
    pLong: 34, pShort: 33, pNoTrade: 33,
    modelStatus: training ? "training" : modelStatus,
    trainedOn, accuracy: modelAccuracy, enabled: false,
  };

  if (!weights || modelStatus !== "trained") return fallback;

  try {
    const norm = normalise(seq50);
    let h = zVec(HIDDEN), c = zVec(HIDDEN);
    for (const x of norm) {
      const concat = [...h, ...x];
      const f = vecAdd(matVec(weights.Wf, concat), weights.bf).map(sigmoid);
      const i = vecAdd(matVec(weights.Wi, concat), weights.bi).map(sigmoid);
      const g = vecAdd(matVec(weights.Wg, concat), weights.bg).map(Math.tanh);
      const o = vecAdd(matVec(weights.Wo, concat), weights.bo).map(sigmoid);
      c = c.map((cv, k) => f[k] * cv + i[k] * g[k]);
      h = o.map((ov, k) => ov * Math.tanh(c[k]));
    }
    const z1 = vecAdd(matVec(weights.W1, h), weights.b1);
    const a1 = z1.map(v => Math.max(0, v));
    const a2 = softmax(vecAdd(matVec(weights.W2, a1), weights.b2));

    const pLong    = Math.round(a2[0] * 100);
    const pShort   = Math.round(a2[1] * 100);
    const pNoTrade = Math.round(a2[2] * 100);
    const maxP     = Math.max(...a2);
    const idx      = a2.indexOf(maxP);
    const signal   = idx === 0 ? "LONG" : idx === 1 ? "SHORT" : "NO_TRADE";
    const confidence = Math.round(maxP * 100);

    return {
      signal, confidence, pLong, pShort, pNoTrade,
      modelStatus: "trained", trainedOn, accuracy: modelAccuracy,
      enabled: confidence >= LSTM_THRESHOLD && signal !== "NO_TRADE",
    };
  } catch { return fallback; }
}

/**
 * Call after saving a new LONG/SHORT trade to DB.
 * Associates the last predicted candle sequence with this trade ID.
 */
export function captureSequenceForTrade(tradeId: number): void {
  if (lastRawSequence && lastRawSequence.length === SEQ_LEN) {
    captureBuffer.set(tradeId, lastRawSequence);
    logger.debug({ tradeId }, "LSTM: sequence captured for trade");
  }
}

/**
 * Call when a trade closes with its outcome.
 * Stores the candle sequence + outcome as a training record.
 */
export function recordTradeOutcome(
  tradeId: number,
  signal: string,       // "LONG" | "SHORT"
  tradeStatus: string   // "TARGET_HIT" | "STOP_HIT"
): void {
  const seq = captureBuffer.get(tradeId);
  captureBuffer.delete(tradeId);
  if (!seq) return;

  const label: 0 | 1 | 2 =
    tradeStatus === "TARGET_HIT" && signal === "LONG"  ? 0 :
    tradeStatus === "TARGET_HIT" && signal === "SHORT" ? 1 : 2;

  appendTrainingRecord(seq, label);
  logger.info({ tradeId, signal, tradeStatus, label }, "LSTM: training record added");
}

/** Retrain if enough new outcomes have accumulated since last training. */
export function lstmRetrainIfNeeded(): void {
  if (training) return;
  const all = loadTrainingData();
  const newSince = all.length - closedAtLastTrain;
  if (
    all.length >= MIN_SAMPLES &&
    (newSince >= RETRAIN_EVERY || (modelStatus === "untrained" && all.length >= MIN_SAMPLES))
  ) {
    logger.info({ records: all.length, newSince }, "LSTM: retraining triggered");
    trainFromRecords().catch(err => logger.error({ err }, "LSTM: retrain failed"));
  }
}

/** Status for analytics panel. */
export function getLSTMStatus(): { mlModelStatus: MLModelStatus; mlTrainedOn: number; mlAccuracy: number } {
  return {
    mlModelStatus: training ? "training" : modelStatus,
    mlTrainedOn:   trainedOn,
    mlAccuracy:    modelAccuracy,
  };
}
