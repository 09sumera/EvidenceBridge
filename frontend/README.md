# EvidenceBridge Frontend — Admin Audit & Claims Explorer

A clean, modern, lightweight local-first web UI built with **React 18 + Vite + TypeScript + Tailwind CSS** for EvidenceBridge.

> **Layer 5 adds a lightweight local frontend and admin audit UI. Advanced evaluation, auth, and production hardening come later.**

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 18+ (tested on Node 20 / 24)
- npm or pnpm
- EvidenceBridge FastAPI backend running at `http://localhost:8000`

### 2. Install Dependencies
```bash
cd frontend
npm install
```

### 3. Start Development Server
```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

All API requests to `/api/v1/*` are automatically proxied to the backend at `http://localhost:8000` via the Vite dev server.

### 4. Build for Production
```bash
npm run build
```
Generates an optimized static bundle in `frontend/dist/`.

---

## 🖥️ Screen Guide

| Route | View | Description |
|---|---|---|
| `/` | **Audit / Extract** | Paste raw clinical notes, hospital bills, or patient posts. Run extraction + verification in one click with instant verdict, cost anomaly alerts, and support score bars. Pre-load sample bills with a single button. |
| `/claims` | **Claims Explorer** | Browse and filter all stored claims. Filter by action (`ACCEPT`, `FLAG`, `ABSTAIN`), cost anomalies only, or geographic locality. Paginated list with direct detail links. |
| `/claims/:claimId` | **Claim Detail &amp; Audit Trail** | Deep audit view. Inspect original verbatim text, cryptographic SHA-256 provenance hash, extracted fields, guideline verification verdict, evidence passages with relevance bars, and the full interactive **9-Stage Decision Audit Graph**. Trigger re-verification on demand. |
| `/trust-density` | **Hyperlocal Trust Density** | Metropolitan reliability dashboard. Search canonical location keys (e.g. `houston_tx`, `chicago_il`) to view composite density scores, anomaly rates, time-decay volume, top anomalous procedure tags, and auditable narrative insights. |

---

## 🧪 Frontend Smoke Checklist

- [ ] Backend is running (`.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000`)
- [ ] Top nav indicator shows green "Backend Online"
- [ ] Home: Click "Try a sample hospital bill" &rarr; click "Extract &amp; Verify Claim" &rarr; verify result card appears
- [ ] Claims: Navigate to `/claims`, verify claims load with badges
- [ ] Claims: Toggle filter to "Flag" or check "Cost Anomalies Only" &rarr; verify list filters correctly
- [ ] Claim Detail: Click any claim &rarr; verify verbatim text, SHA-256 copy button, and 9-stage audit timeline render
- [ ] Trust Density: Navigate to `/trust-density` &rarr; click `houston_tx` &rarr; verify composite score bar, metrics grid, and insight card render
