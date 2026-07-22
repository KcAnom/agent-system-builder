# Plan: Cloudflare static + local API (Tunnel) — personal use

**Goal:** Use Agent System Studio from your phone against the app running on your laptop.  
**Not a product.** No multi-user, no serverless forever, no rewrite.  
**You build this later from this plan.**

---

## 0. What you’re building

```
  Phone (Safari / Chrome)
           │
           │  HTTPS
           ▼
  Cloudflare edge
           │
           │  Tunnel (encrypted)
           ▼
  Your laptop
    └── node server (Express)
          ├── static UI  (public/)
          └── /api/*     (agents, sketch, run)
          └── ~/.pi      (models + auth.json)
```

**Two deploy shapes** (pick one when you build):

| Shape | What Cloudflare hosts | What laptop hosts | Complexity | Recommendation for *you* |
|-------|------------------------|-------------------|------------|---------------------------|
| **A · Full tunnel** | Nothing (or just DNS/name) | **Everything** — UI + API on `:4747` | Lowest | **Start here** |
| **B · Pages + API tunnel** | Static UI on **Pages** | Only API (and model calls) | Medium | Optional polish later |

For personal mobile → laptop, **Shape A is enough**. Shape B only if you want the UI on a Pages URL while the API still hits your machine.

---

## 1. Prerequisites (laptop)

- [ ] App runs locally: `cd ~/agent-system-builder && npm start` → `http://localhost:4747`
- [ ] Sketch works with a **ready Pi model** (e.g. GLM) from the UI
- [ ] Cloudflare account (free is fine)
- [ ] `wrangler` installed (you already have `4.x`)
- [ ] Laptop awake / not sleeping when you use phone (or disable sleep while using)
- [ ] Same Wi‑Fi optional — Tunnel works from cellular too

---

## 2. Shape A — Full tunnel (recommended first)

Expose the whole Express app. Phone hits one HTTPS URL; everything (HTML, JS, `/api`, sketch) goes to your laptop.

### 2.1 Install / login cloudflared

```bash
# macOS
brew install cloudflared

# login (opens browser once)
cloudflared tunnel login
```

### 2.2 Create a named tunnel

```bash
cloudflared tunnel create agent-studio
# note the Tunnel ID printed
```

Credentials land under `~/.cloudflared/<TUNNEL_ID>.json`.

### 2.3 Config file

Create `~/.cloudflared/config.yml` (adjust paths/names):

```yaml
tunnel: agent-studio
credentials-file: /Users/kc/.cloudflared/<TUNNEL_ID>.json

ingress:
  # Personal hostname — use a domain you already have on Cloudflare,
  # OR use a free trycloudflare quick tunnel for throwaway testing (see 2.5).
  - hostname: agent-studio.YOURDOMAIN.com
    service: http://127.0.0.1:4747
  - service: http_status:404
```

### 2.4 DNS route (if using your domain)

```bash
cloudflared tunnel route dns agent-studio agent-studio.YOURDOMAIN.com
```

Domain must be on the same Cloudflare account.

### 2.5 Quick test without a domain (throwaway URL)

For a one-off session (URL changes each run):

```bash
# terminal 1
cd ~/agent-system-builder && npm start

# terminal 2
cloudflared tunnel --url http://127.0.0.1:4747
```

Cloudflare prints something like `https://random-words.trycloudflare.com`.  
Open that on your phone. **Anyone with the link can hit it while the tunnel is up** — treat as temporary.

### 2.6 Run for daily personal use (named tunnel)

```bash
# terminal 1 — app
cd ~/agent-system-builder && npm start

# terminal 2 — tunnel
cloudflared tunnel run agent-studio
```

Optional: launchd/plist later so tunnel starts at login (only if you want always-on).

### 2.7 Phone checklist

- [ ] Open `https://agent-studio.YOURDOMAIN.com` (or trycloudflare URL)
- [ ] Fleet loads
- [ ] Pick Pi model → sketch from intent
- [ ] Run agent + human gate still works
- [ ] Cellular data works (not only home Wi‑Fi)

### 2.8 Security (personal, minimum)

Because this is **your laptop with your API keys via ~/.pi**:

| Control | What to do | Why |
|---------|------------|-----|
| **Prefer named tunnel + your domain** | Not public marketing | Stable URL you control |
| **Cloudflare Access (free tier)** | One-time email OTP for *your* email only | Stops random people if URL leaks |
| **Don’t commit secrets** | Tunnel creds stay in `~/.cloudflared` | Never in the repo |
| **Stop tunnel when done** | Ctrl+C on `cloudflared` | No open door while laptop sits |
| **Laptop firewall** | Only localhost:4747; tunnel is the ingress | Don’t port-forward 4747 on router |
| **HTTPS only** | Cloudflare terminates TLS | Phone never talks plain HTTP to the world |

**Cloudflare Access (highly recommended even for solo):**

1. Zero Trust dashboard → Access → Applications → Self-hosted  
2. Application domain: `agent-studio.YOURDOMAIN.com`  
3. Policy: include email = **only your email**  
4. You get a login page on the phone once; then cookie session  

No code changes required for Access in front of the tunnel.

### 2.9 CORS / cookies / same origin

Shape A serves UI and API from the **same host** → **no CORS changes needed**.  
Current `fetch("/api/...")` keeps working.

---

## 3. Shape B — Pages UI + tunnel only for API (optional later)

Use only if you want:

- UI cached on Cloudflare Pages  
- API + model calls still on laptop  

### 3.1 Split mentally

| Path | Host |
|------|------|
| `/`, `/styles.css`, `/app.js`, … | Cloudflare Pages |
| `/api/*` | Tunnel → `http://127.0.0.1:4747` |

### 3.2 Code changes you’ll need later (not now)

1. **API base URL in the frontend**  
   - Today: `const API = ""` (same origin)  
   - Later: e.g. `const API = "https://api-agent-studio.YOURDOMAIN.com"`  
   - Or build-time inject via Pages env `window.__API_BASE__`

2. **CORS on Express**  
   - Allow origin: your Pages URL only  
   - `Access-Control-Allow-Headers: Content-Type`  
   - Credentials only if you add cookies (you don’t need them for solo token-less use)

3. **Tunnel ingress** points API hostname → `http://127.0.0.1:4747`  
   - Pages project does **not** go through the tunnel

4. **Deploy UI**

```bash
# from project root — publish only public/
npx wrangler pages project create agent-system-studio   # once
npx wrangler pages deploy public --project-name=agent-system-studio
```

5. **Phone** opens Pages URL; all `/api` calls hit tunnel hostname.

### 3.3 Why you might skip Shape B

- Extra CORS and config  
- Sketch still needs laptop online anyway  
- Full tunnel (A) already gives mobile HTTPS  

**For personal use: stay on Shape A until it annoys you.**

---

## 4. Mobile UX (separate from hosting — still plan it)

Tunnel does **not** make the UI phone-friendly. When you build, also plan a small responsive pass:

| Breakpoint | Behavior |
|------------|----------|
| `< 768px` | Bottom nav: **Fleet · Build · Live** |
| Fleet | Intent + model picker + list (full width) |
| Build | Layer list instead of 3×3 canvas; tap → full-screen inspector |
| Live | Run box, breakers, Approve/Reject primary |
| Desktop | Keep current 3-column studio |

This is CSS/JS only; works the same on localhost and via tunnel.

Suggested later tasks (when you implement):

1. `styles.css` — bottom nav + hide canvas grid on small screens  
2. `app.js` — tab state `fleet | build | live` on mobile  
3. Bigger touch targets for Approve / Sketch  

---

## 5. Day-to-day personal workflow (after you build)

```text
1. Open laptop, unlock, stay awake (or plug in + prevent sleep)
2. Terminal: npm start
3. Terminal: cloudflared tunnel run agent-studio
4. Phone: https://agent-studio.YOURDOMAIN.com  (+ Access login if enabled)
5. Sketch / run / approve from couch or away from desk
6. When done: stop tunnel (and optionally stop node)
```

Optional niceties (later):

- Shell alias: `studio-up` → starts node + tunnel  
- `caffeinate -dimsu` while studio is up (macOS keep awake)  
- Menu bar tool for cloudflared if you want GUI  

---

## 6. Failure modes (know these before you rely on it)

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Phone can’t load | Laptop sleep / offline | Wake laptop; check tunnel process |
| 502 Bad Gateway | Node not running on 4747 | `npm start` |
| Sketch fails on phone | Same as desktop (model balance/auth) | Switch Pi model in UI |
| Works on Wi‑Fi, not cellular | Rare DNS/Access glitch | Retry; check Access policy |
| Slow sketch | Model + uplink from home | Normal; not CF CPU (work is on laptop) |
| trycloudflare URL dead next day | Ephemeral tunnel | Use named tunnel + domain |

---

## 7. Explicit non-goals (this plan)

- ❌ Multi-tenant product  
- ❌ Moving API to Workers / D1 / R2  
- ❌ Hosting `~/.pi` or MLX in the cloud  
- ❌ Public marketing site  
- ❌ Always-on VPS  

If you later want “works when laptop is off,” that’s a **different plan** (Workers + D1 + AI Gateway).

---

## 8. Build order (when you implement)

Do in this order; stop whenever “good enough for me”:

1. **Confirm local app** — sketch + run on desktop  
2. **Quick tunnel test** — `cloudflared tunnel --url http://127.0.0.1:4747` + phone  
3. **Named tunnel + domain** (if you have one on CF)  
4. **Cloudflare Access** — lock to your email  
5. **(Optional)** `studio-up` script + prevent sleep  
6. **(Optional)** Mobile CSS bottom nav  
7. **(Optional)** Shape B Pages split — only if you care  

---

## 9. Minimal commands cheat sheet

```bash
# App
cd ~/agent-system-builder
npm start

# Throwaway public URL (testing)
cloudflared tunnel --url http://127.0.0.1:4747

# Named tunnel (after setup)
cloudflared tunnel run agent-studio

# Optional: keep Mac awake while testing
caffeinate -dimsu &
```

---

## 10. Success criteria (personal)

You’re done when:

- [ ] Phone opens the studio over HTTPS without being on home Wi‑Fi  
- [ ] You can sketch with a selected Pi model from the phone  
- [ ] You can approve a human-gate action from the phone  
- [ ] Random people can’t use it (Access or tunnel stopped when idle)  
- [ ] Laptop must be on — you accept that tradeoff  

---

## 11. Decision record

| Choice | Decision |
|--------|----------|
| Hosting model | Local Node + Cloudflare Tunnel |
| UI host | Same as API (Shape A) first |
| Auth | Cloudflare Access (email) recommended |
| Data / models | Stay on laptop (`data/`, `~/.pi`) |
| Cost | Free CF tier sufficient for solo |
| Next architecture if needed | Full CF Workers plan (separate doc) |

---

*Plan only — no infrastructure was changed by writing this file.*  
*App path: `/Users/kc/agent-system-builder`*  
*Related app port: `4747`*
