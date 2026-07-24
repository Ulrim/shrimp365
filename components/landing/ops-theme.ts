// Shared "ops-console" visual system (flat / blue + amber / mono data).
// Scoped under `.s365` so it never leaks into the rest of the app.
// Used by the landing page and the public auth screens (login / signup).

export const OPS_CSS = `
.s365{
  --s-blue:#1E40AF; --s-blue2:#3B82F6; --s-amber:#D97706;
  --s-bg:#F4F7FB; --s-panel:#FFFFFF; --s-ink:#0F1E3D; --s-sub:#4A5B78;
  --s-muted:#E9EEF6; --s-border:#D8E2F0; --s-hair:#E6ECF5;
  --s-good:#059669; --s-warn:#D97706; --s-crit:#DC2626;
  --s-mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
  --s-maxw:1120px;
  background:var(--s-bg); color:var(--s-ink); min-height:100vh;
}
@media (prefers-color-scheme:dark){
  .s365{
    --s-bg:#0A1220; --s-panel:#111C31; --s-ink:#E7EEFA; --s-sub:#93A4C2;
    --s-muted:#16233C; --s-border:#243450; --s-hair:#1B2942;
    --s-blue:#60A5FA; --s-blue2:#3B82F6; --s-amber:#F59E0B;
    --s-good:#34D399; --s-warn:#FBBF24; --s-crit:#F87171;
  }
}
.s365 *{box-sizing:border-box}
.s365 .mono{font-family:var(--s-mono);font-variant-numeric:tabular-nums}
.s365 .s365-wrap{max-width:var(--s-maxw);margin:0 auto;padding:0 24px}
.s365 a{color:inherit;text-decoration:none}
.s365 h1,.s365 h2,.s365 h3{margin:0;text-wrap:balance;letter-spacing:-.01em}
.s365 .s365-eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--s-blue);font-weight:600}

/* header */
.s365-header{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--s-bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--s-hair)}
.s365-nav{display:flex;align-items:center;gap:20px;height:60px}
.s365-brand{display:flex;align-items:center;gap:9px;font-weight:700;letter-spacing:-.02em;font-size:17px}
.s365-mark{width:26px;height:26px;border:1.5px solid var(--s-blue);border-radius:7px;display:grid;place-items:center;color:var(--s-blue);flex:0 0 auto}
.s365-links{display:flex;gap:22px;margin-left:14px;font-size:13.5px;color:var(--s-sub)}
.s365-links a:hover{color:var(--s-ink)}
.s365-navright{margin-left:auto;display:flex;align-items:center;gap:10px}
.s365-chips{display:flex;gap:2px;font-family:var(--s-mono);font-size:12px;color:var(--s-sub);align-items:center}
.s365-chips a{padding:3px 6px;border-radius:6px}
.s365-chips a[aria-current]{color:var(--s-ink);background:var(--s-muted)}
.s365-chips a:hover{color:var(--s-ink)}
.s365-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:38px;padding:0 16px;border-radius:8px;font-size:13.5px;font-weight:600;border:1px solid transparent;cursor:pointer;transition:background .16s ease,border-color .16s ease,color .16s ease,filter .16s ease;white-space:nowrap;font-family:inherit}
.s365-btn.lg{height:46px;padding:0 22px;font-size:15px}
.s365-btn.full{width:100%}
.s365-btn.primary{background:var(--s-blue);color:#fff}
.s365-btn.primary:hover{background:var(--s-blue2)}
.s365-btn.primary:disabled{opacity:.6;cursor:default}
.s365-btn.ghost{border-color:var(--s-border);color:var(--s-ink);background:transparent}
.s365-btn.ghost:hover{background:var(--s-muted)}
.s365-btn.amber{background:var(--s-amber);color:#1a1204}
.s365-btn.amber:hover{filter:brightness(1.07)}
.s365-btn.oncolor{background:#fff;color:var(--s-blue)}
.s365-btn.oncolor:hover{filter:brightness(.96)}
.s365-btn.oncolor-ghost{border-color:rgba(255,255,255,.4);color:#fff;background:transparent}
.s365-btn.oncolor-ghost:hover{background:rgba(255,255,255,.12)}
.s365-burger{display:none;border:1px solid var(--s-border);background:transparent;color:var(--s-ink);width:40px;height:40px;border-radius:8px;align-items:center;justify-content:center}
.s365-mobile{display:flex;flex-direction:column;gap:4px;padding:12px 24px 18px;border-top:1px solid var(--s-hair);background:var(--s-panel)}
.s365-mobile a{padding:10px 4px;color:var(--s-ink);font-size:15px}
.s365-mobile-demo{text-align:left;padding:10px 4px;background:none;border:none;color:var(--s-blue);font-size:15px;cursor:pointer;font-family:inherit}
.s365-mobile-row{display:flex;gap:10px;margin-top:8px}

/* hero */
.s365-hero{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center;padding:74px 0 56px}
.s365-h1{font-size:clamp(30px,4.6vw,52px);font-weight:800;line-height:1.08;margin:16px 0 18px}
.s365-h1 b{color:var(--s-blue);font-weight:800}
.s365-lede{font-size:16.5px;color:var(--s-sub);max-width:46ch;margin:0 0 26px;white-space:pre-line}
.s365-cta-row{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:22px}
.s365-trust{display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--s-sub)}
.s365-trust span{display:inline-flex;align-items:center;gap:6px}
.s365-dot{width:7px;height:7px;border-radius:50%;background:var(--s-good);display:inline-block}
.s365-dot.ok{background:var(--s-good)}

/* console */
.s365-console{background:var(--s-panel);border:1px solid var(--s-border);border-radius:14px;overflow:hidden}
.s365-con-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--s-hair)}
.s365-con-t{font-size:12.5px;font-weight:600}
.s365-live{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--s-good);text-transform:uppercase;letter-spacing:.12em}
.s365-live .s365-dot{background:var(--s-good);animation:s365pulse 1.8s ease-in-out infinite}
@keyframes s365pulse{0%,100%{opacity:1}50%{opacity:.35}}
.s365-grid6{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--s-hair)}
.s365-cell{background:var(--s-panel);padding:13px 14px}
.s365-k{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--s-sub)}
.s365-v{font-size:21px;font-weight:600;margin-top:3px;color:var(--s-ink)}
.s365-v small{font-size:11px;color:var(--s-sub);font-weight:400;margin-left:2px}
.s365-cell.warn{background:color-mix(in srgb,var(--s-warn) 9%,var(--s-panel))}
.s365-cell.warn .s365-v{color:var(--s-warn)}
.s365-cell.crit{background:color-mix(in srgb,var(--s-crit) 10%,var(--s-panel))}
.s365-cell.crit .s365-v{color:var(--s-crit)}
.s365-con-alert{display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid var(--s-hair);background:color-mix(in srgb,var(--s-crit) 7%,var(--s-panel))}
.s365-msg{font-size:12.5px}
.s365-time{margin-left:auto;font-size:11px;color:var(--s-sub)}
.s365-spark{padding:10px 16px 16px;border-top:1px solid var(--s-hair)}
.s365-cap{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--s-sub);margin-bottom:6px}

/* strip */
.s365-strip{border-top:1px solid var(--s-hair);border-bottom:1px solid var(--s-hair);background:var(--s-panel)}
.s365-stats{display:grid;grid-template-columns:repeat(4,1fr)}
.s365-stat{padding:26px 8px;text-align:center;border-right:1px solid var(--s-hair)}
.s365-stat:last-child{border-right:0}
.s365-n{font-size:30px;font-weight:700;color:var(--s-blue)}
.s365-stat .s365-l{font-size:13px;color:var(--s-sub);margin-top:4px}

/* sections */
.s365-blk{padding:64px 0}
.s365-panelbg{background:var(--s-panel);border-top:1px solid var(--s-hair);border-bottom:1px solid var(--s-hair)}
.s365-sec-head{max-width:56ch;margin-bottom:34px}
.s365-h2{font-size:clamp(24px,3vw,34px);font-weight:800;margin:10px 0}
.s365-sec-head p{color:var(--s-sub);margin:0;font-size:15.5px}

.s365-feat{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.s365-card{background:var(--s-panel);border:1px solid var(--s-border);border-radius:10px;padding:20px;transition:border-color .16s ease,background .16s ease}
.s365-card:hover{border-color:var(--s-blue2);background:color-mix(in srgb,var(--s-blue2) 4%,var(--s-panel))}
.s365-cic{width:38px;height:38px;border-radius:9px;display:grid;place-items:center;background:var(--s-muted);color:var(--s-blue);margin-bottom:13px}
.s365-card h3{font-size:15.5px;font-weight:700;margin-bottom:6px}
.s365-card p{font-size:13.5px;color:var(--s-sub);margin:0;line-height:1.55}

.s365-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.s365-step{border-top:2px solid var(--s-blue);padding:16px 4px 0}
.s365-stepnum{font-size:12px;color:var(--s-blue);font-weight:600;letter-spacing:.1em;display:flex;align-items:center;gap:8px}
.s365-stepic{color:var(--s-blue2)}
.s365-step h3{font-size:15px;font-weight:700;margin:8px 0 6px}
.s365-step p{font-size:13px;color:var(--s-sub);margin:0;line-height:1.55}

.s365-tgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.s365-tcard{background:var(--s-panel);border:1px solid var(--s-border);border-radius:10px;padding:20px}
.s365-quote{font-size:14px;line-height:1.6;margin:0 0 16px;color:var(--s-ink)}
.s365-trow{display:flex;align-items:center;justify-content:space-between;gap:8px}
.s365-tname{font-size:13.5px;font-weight:600}
.s365-tloc{font-size:11.5px;color:var(--s-sub);margin-top:2px}
.s365-tbadge{font-size:11px;color:var(--s-blue);background:var(--s-muted);padding:3px 8px;border-radius:20px}

.s365-free{background:var(--s-panel);border:1px solid var(--s-border);border-radius:16px;padding:40px;text-align:center}
.s365-freesub{color:var(--s-sub);max-width:52ch;margin:6px auto 0;white-space:pre-line}
.s365-freelist{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 24px;max-width:640px;margin:26px auto 30px;text-align:left}
.s365-fitem{display:flex;gap:9px;align-items:center;font-size:14px}

.s365-faqwrap{max-width:760px}
.s365-faqs{display:flex;flex-direction:column;gap:10px}
.s365-faq{background:var(--s-bg);border:1px solid var(--s-border);border-radius:10px;overflow:hidden}
.s365-faq>button{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;background:none;border:none;color:var(--s-ink);font-size:14.5px;font-weight:600;text-align:left;cursor:pointer;font-family:inherit}
.s365-faq>button:hover{background:var(--s-muted)}
.s365-faqa{padding:0 18px 16px;color:var(--s-sub);font-size:13.5px;line-height:1.65}

.s365-finalcta{background:var(--s-blue);border-radius:16px;padding:52px 40px;text-align:center}
.s365-finalcta .s365-h2{margin-bottom:12px}
.s365-ctasub{color:rgba(255,255,255,.85);margin:0 auto 26px;max-width:48ch;white-space:pre-line}
.s365-ctahint{color:rgba(255,255,255,.7);font-size:12px;margin-top:18px}

.s365-footer{border-top:1px solid var(--s-hair);padding:30px 0;color:var(--s-sub);font-size:12.5px;background:var(--s-panel)}
.s365-foot{display:flex;flex-wrap:wrap;gap:16px 24px;align-items:center;justify-content:space-between}
.s365-footlinks{display:flex;gap:18px}
.s365-footlinks a:hover{color:var(--s-ink)}
.s365-copy{font-size:12px}

/* ── Auth screens (login / signup) ────────────────────────────────── */
.s365-auth{min-height:100vh;display:flex}
.s365-auth-side{width:46%;position:relative;padding:48px;display:flex;flex-direction:column;justify-content:space-between;background:var(--s-panel);border-right:1px solid var(--s-hair)}
.s365-auth-main{flex:1;display:flex;align-items:center;justify-content:center;padding:32px 24px}
.s365-auth-card{width:100%;max-width:420px}
.s365-auth-card .s365-console{margin-bottom:0}
.s365-authbox{background:var(--s-panel);border:1px solid var(--s-border);border-radius:14px;padding:28px}
.s365-authbox .top{border-bottom:1px solid var(--s-hair);margin:-28px -28px 22px;padding:16px 28px;display:flex;align-items:center;gap:8px}
.s365-authbox h1{font-size:20px;font-weight:800;margin:0}
.s365-fieldrow{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
.s365-fieldrow label{font-size:12.5px;font-weight:600;color:var(--s-sub)}
.s365-input{width:100%;height:44px;padding:0 12px;border:1px solid var(--s-border);border-radius:8px;background:var(--s-bg);color:var(--s-ink);font-size:14px;font-family:inherit;transition:border-color .16s ease}
.s365-input:focus{outline:none;border-color:var(--s-blue2);box-shadow:0 0 0 3px color-mix(in srgb,var(--s-blue2) 18%,transparent)}
.s365-inwrap{position:relative}
.s365-inwrap .toggle{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--s-sub);background:none;border:none;cursor:pointer;display:grid;place-items:center}
.s365-inwrap .toggle:hover{color:var(--s-ink)}
.s365-hint{font-size:12px;color:var(--s-sub);margin-top:6px}
.s365-alert{display:flex;align-items:center;gap:8px;font-size:13px;padding:10px 12px;border-radius:8px;margin-bottom:14px;border:1px solid}
.s365-alert.err{color:var(--s-crit);background:color-mix(in srgb,var(--s-crit) 9%,var(--s-panel));border-color:color-mix(in srgb,var(--s-crit) 25%,transparent)}
.s365-alert.ok{color:var(--s-good);background:color-mix(in srgb,var(--s-good) 9%,var(--s-panel));border-color:color-mix(in srgb,var(--s-good) 25%,transparent)}
.s365-divider{display:flex;align-items:center;gap:12px;margin:18px 0;color:var(--s-sub);font-size:12px}
.s365-divider::before,.s365-divider::after{content:"";flex:1;height:1px;background:var(--s-hair)}
.s365-authfoot{text-align:center;margin-top:16px;font-size:13.5px;color:var(--s-sub);display:flex;flex-direction:column;gap:6px}
.s365-authfoot a{color:var(--s-blue);font-weight:600}
.s365-authfoot a:hover{text-decoration:underline}
.s365-sidefeat{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:22px}
.s365-sidefeat .it{display:flex;align-items:center;gap:9px;border:1px solid var(--s-border);border-radius:9px;padding:11px 12px;font-size:13px;color:var(--s-sub);background:var(--s-bg)}
.s365-sidefeat .it svg{color:var(--s-blue);flex:0 0 auto}
.s365-strength{display:flex;gap:4px;margin-top:8px}
.s365-strength i{height:4px;flex:1;border-radius:9999px;background:var(--s-muted)}

/* responsive */
@media (max-width:900px){
  .s365-hero{grid-template-columns:1fr;gap:32px;padding:44px 0 36px}
  .s365-feat,.s365-tgrid{grid-template-columns:1fr 1fr}
  .s365-steps{grid-template-columns:1fr 1fr}
  .s365-links{display:none}
  .s365-burger{display:inline-flex}
  .s365-hide-sm{display:none}
  .s365-auth-side{display:none}
}
@media (max-width:560px){
  .s365-wrap{padding:0 16px}
  .s365-feat,.s365-tgrid,.s365-steps,.s365-freelist{grid-template-columns:1fr}
  .s365-stats{grid-template-columns:1fr 1fr}
  .s365-stat:nth-child(2n){border-right:0}
  .s365-grid6{grid-template-columns:repeat(2,1fr)}
  .s365-free,.s365-finalcta{padding:28px 20px}
  .s365-chips{display:none}
  .s365-foot{flex-direction:column;align-items:flex-start;gap:12px}
}
@media (prefers-reduced-motion:reduce){ .s365 *{animation:none!important;transition:none!important} }
`
