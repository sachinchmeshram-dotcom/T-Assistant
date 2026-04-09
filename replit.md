# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── gold-swing-ai/      # Gold Swing AI Pro - React frontend
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## Gold Intraday AI App

A professional XAUUSD gold **intraday trading** dashboard with:

- **Live price feed** via Finnhub WebSocket (`OANDA:XAU_USD`), goldprice.org as gap-filler
- **1H OHLC TradingView chart** (default) + Live Tick Chart tab
- **SMC Signal Engine**: Smart Money Concepts on 1H/4H candles (market structure, BOS, liquidity sweeps, order blocks)
- **Session awareness**: London / New York / Asian detection; Asian session raises confidence thresholds (low liquidity)
- **Daily Pivot Points**: R2/R1/PP/S1/S2 from previous day's OHLC, displayed in signal panel
- **Self-learning analytics**: per-condition win rate tracking, adaptive weights (±8 pts), Smart Mode
- **Pure-TS LSTM Neural Network**: trained on 1H candle sequences from completed trade outcomes
  - Min 15 closed trades to train; retrains every 30 new trades
  - LSTM drives signal at ≥65% confidence; SMC fallback when untrained
- **Technical indicators**: RSI(14), EMA20/50/200, MACD, ATR — all on 1H candles
- **Multi-timeframe trend**: 4H context / 1H confirmation / 15m entry refinement
- **Signal cooldown**: 4-hour intraday cooldown (was 5-min for scalping)
- **SL/TP**: ATR×1.5 (min $8) for SL, 2.5× SL for TP — wider intraday distances
- **Trade duration**: "2-8 hours" (was "5-15 minutes")
- **Signal History + Trade Tracker**: auto-closes trades on TP/SL hit, tracks P&L

### Neural Network (`artifacts/api-server/src/lib/mlModel.ts`)
- Architecture: 6 inputs → 24 hidden (ReLU) → 12 hidden (ReLU) → 3 outputs (Softmax)
- Labels: 0=LONG success, 1=SHORT success, 2=STOP_HIT
- Features: `[structure(-1/0/1), bos, liquiditySweep, inOrderBlock, smcScore/100, confidence/100]`
- Optimizer: Adam (lr=0.005, β1=0.9, β2=0.999); 200 epochs, batch=32, 80/20 val split
- **No TF.js** — pure TypeScript matrix math; works on any Node.js version

### API Endpoints
- `GET /api/price` - live XAUUSD price
- `WS  /api/price/ws` - WebSocket real-time tick stream
- `GET /api/signal` - SMC + ML AI signal
- `GET /api/analytics` - performance analytics + ML model status
- `GET /api/history` - signal history
- `POST /api/trade/close/:id` - close open trade

### Key Files
- `artifacts/api-server/src/lib/mlModel.ts` - pure-TS neural network
- `artifacts/api-server/src/lib/signalEngine.ts` - SMC + ML signal generation
- `artifacts/api-server/src/lib/performanceAnalytics.ts` - self-learning analytics
- `artifacts/api-server/src/lib/tradeTracker.ts` - auto trade close + ML retrain
- `artifacts/api-server/src/lib/priceEvents.ts` - Finnhub WS + tick buffer
- `artifacts/gold-swing-ai/src/components/trading/signal-panel.tsx` - signal + NN display
- `artifacts/gold-swing-ai/src/components/trading/analytics-panel.tsx` - analytics + ML card
- `lib/db/src/schema/signals.ts` - signals table (SMC fields: marketStructure, bosPresent, etc.)

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`); `src/routes/trading.ts` exposes gold trading endpoints
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `artifacts/gold-swing-ai` (`@workspace/gold-swing-ai`)

React + Vite frontend for Gold Swing AI Pro. Uses TanStack React Query for data fetching, Tailwind CSS for styling.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/signals.ts` — signals table with insert schemas
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
