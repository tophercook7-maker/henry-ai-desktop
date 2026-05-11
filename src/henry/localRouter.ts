/**
 * Henry Local Router — answers common queries from SQLite without touching AI.
 *
 * The cost-efficiency engine. When the user types something Henry can answer
 * from his own database, we skip Groq entirely. Saves tokens, saves money,
 * answers instantly, works offline.
 *
 * Pattern → SQL/IPC → formatted markdown reply.
 *
 * Returns:
 *   - { handled: true, reply: string }  → bypass AI, render `reply` as Henry's answer
 *   - { handled: false }                 → fall through to the normal AI pipeline
 *
 * Add a new intent: append a Handler to INTENTS. Each handler tests the query
 * and (if matched) returns a formatted string. Order matters — first match wins.
 */

type Handler = {
  name: string;
  match: (q: string) => boolean;
  run: () => Promise<string | null>;
};

export interface LocalRouteResult {
  handled: boolean;
  reply?: string;
  intentName?: string;
}

function api(): Record<string, (...args: unknown[]) => Promise<unknown>> | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { henryAPI?: Record<string, (...args: unknown[]) => Promise<unknown>> }).henryAPI || null;
}

function thisMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMoney(n: number | null | undefined): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function fmtMinutes(m: number | null | undefined): string {
  const mins = Number(m) || 0;
  if (mins < 60) return `${Math.round(mins)} min`;
  const hours = Math.floor(mins / 60);
  const r = Math.round(mins % 60);
  return r ? `${hours}h ${r}m` : `${hours}h`;
}

// ── Pattern test helpers ────────────────────────────────────────────────────
const re = (...pats: RegExp[]) => (q: string) => pats.some(p => p.test(q));

// ── Intents ─────────────────────────────────────────────────────────────────
const INTENTS: Handler[] = [

  // What colors do I have? / Show my color library
  {
    name: 'colors',
    match: re(/what colors? (do i|are|i)/i, /show (me )?(my )?colors?/i, /color library/i, /list (my )?colors/i),
    run: async () => {
      const a = api(); if (!a?.makerMaterialsColors) return null;
      const list = await a.makerMaterialsColors() as Array<{color:string; color_hex?:string; category:string; count:number; total_stock:number}>;
      if (!list?.length) return "You don't have any colored materials tracked yet. Add a material with a color in the Materials panel and I'll know.";
      const byCat = new Map<string, typeof list>();
      list.forEach(c => {
        if (!byCat.has(c.category)) byCat.set(c.category, []);
        byCat.get(c.category)!.push(c);
      });
      const sections: string[] = [];
      byCat.forEach((items, cat) => {
        sections.push(`**${cat}** — ${items.length} color${items.length===1?'':'s'}`);
        items.forEach(c => {
          const hex = c.color_hex ? ` (${c.color_hex})` : '';
          sections.push(`  • ${c.color}${hex} — ${c.count} item${c.count===1?'':'s'}`);
        });
      });
      return `Here's your color library:\n\n${sections.join('\n')}`;
    },
  },

  // What materials do I have / what's in inventory
  {
    name: 'materials',
    match: re(/what materials? (do i|are|i have)/i, /show (me )?(my )?materials?/i, /list (my )?materials/i, /(my )?inventory/i, /what'?s in stock/i),
    run: async () => {
      const a = api(); if (!a?.makerMaterialsList) return null;
      const list = await a.makerMaterialsList({ activeOnly: true }) as Array<{name:string;category:string;quantity_total:number;unit:string;reorder_threshold?:number}>;
      if (!list?.length) return "Your materials inventory is empty. Add materials in the Materials panel.";
      const byCat = new Map<string, typeof list>();
      list.forEach(m => {
        if (!byCat.has(m.category)) byCat.set(m.category, []);
        byCat.get(m.category)!.push(m);
      });
      const out = [`You have **${list.length}** material${list.length===1?'':'s'} across **${byCat.size}** categor${byCat.size===1?'y':'ies'}:`, ''];
      byCat.forEach((items, cat) => {
        out.push(`**${cat}**`);
        items.forEach(m => {
          const low = (m.reorder_threshold ?? 0) > 0 && m.quantity_total <= (m.reorder_threshold ?? 0);
          out.push(`  • ${m.name} — ${m.quantity_total}${m.unit}${low ? ' ⚠️ LOW' : ''}`);
        });
        out.push('');
      });
      return out.join('\n').trim();
    },
  },

  // What's running low / what should I reorder
  {
    name: 'low_stock',
    match: re(/what'?s (running )?low/i, /what should i reorder/i, /low stock/i, /need to (re)?order/i),
    run: async () => {
      const a = api(); if (!a?.makerMaterialsList) return null;
      const list = await a.makerMaterialsList({ lowStock: true }) as Array<{name:string;category:string;quantity_total:number;unit:string;reorder_threshold?:number;supplier?:string;supplier_url?:string}>;
      if (!list?.length) return "Nothing's low on stock right now. ✓";
      const out = [`**${list.length}** item${list.length===1?'':'s'} below your reorder threshold:`, ''];
      list.forEach(m => {
        const supplier = m.supplier ? ` from ${m.supplier}` : '';
        const url = m.supplier_url ? ` ${m.supplier_url}` : '';
        out.push(`• **${m.name}** (${m.category}) — ${m.quantity_total}${m.unit} left, threshold ${m.reorder_threshold}${m.unit}${supplier}${url}`);
      });
      return out.join('\n');
    },
  },

  // What machines do I have
  {
    name: 'machines',
    match: re(/what machines? (do i|are|i have)/i, /show (me )?(my )?machines/i, /list (my )?machines/i, /(my )?workshop/i),
    run: async () => {
      const a = api(); if (!a?.makerMachinesList) return null;
      const list = await a.makerMachinesList({ activeOnly: true }) as Array<{name:string;machine_type:string;brand?:string;model?:string;status:string}>;
      if (!list?.length) return "No machines tracked yet. Add one in the Machines panel.";
      const out = [`You have **${list.length}** machine${list.length===1?'':'s'}:`, ''];
      list.forEach(m => {
        const id = [m.brand, m.model].filter(Boolean).join(' ');
        const status = m.status === 'idle' ? '' : ` _(${m.status})_`;
        out.push(`• **${m.name}** — ${m.machine_type}${id ? ', ' + id : ''}${status}`);
      });
      return out.join('\n');
    },
  },

  // What's my profit / revenue / cost this month
  {
    name: 'monthly_profit',
    match: re(/(what'?s |show )?(my )?profit (this )?month/i, /revenue (this )?month/i, /how (much )?(have i made|did i make) (this )?month/i, /workshop (profit|earnings)/i),
    run: async () => {
      const a = api(); if (!a?.makerRunsSummary) return null;
      const month = thisMonthStr();
      const s = await a.makerRunsSummary({ month }) as {runs:number; total_cost:number; revenue:number; profit:number; total_minutes:number};
      if (!s || !s.runs) return `No production runs logged yet for ${month}. Log your jobs in the Runs panel and I'll calculate profit automatically.`;
      return `**${month} workshop summary:**\n\n• ${s.runs} production run${s.runs===1?'':'s'}\n• Time: ${fmtMinutes(s.total_minutes)}\n• Revenue: ${fmtMoney(s.revenue)}\n• Cost: ${fmtMoney(s.total_cost)}\n• **Profit: ${fmtMoney(s.profit)}**`;
    },
  },

  // What's my income / expenses this month
  {
    name: 'monthly_finance',
    match: re(/(what'?s |show )?(my )?(income|expenses?|spending|finance) (this )?month/i, /how much (did i (make|spend|earn))/i),
    run: async () => {
      const a = api(); if (!a?.financeSummary && !(a as any)?.['finance:summary']) return null;
      // Note: `financeSummary` may not be a preload alias — call via direct invoke if needed
      let s: {income:number; expenses:number; net:number; breakdown:unknown[]} | null = null;
      try {
        // Most direct path — the preload lacks a typed alias for finance:summary, so route via invoke
        if ((window as any).electronAPI?.invoke) {
          s = await (window as any).electronAPI.invoke('finance:summary', thisMonthStr()) as typeof s;
        }
      } catch { /* ignore */ }
      if (!s) return null;
      return `**${thisMonthStr()} finance:**\n\n• Income: ${fmtMoney(s.income)}\n• Expenses: ${fmtMoney(s.expenses)}\n• **Net: ${fmtMoney(s.net)}**`;
    },
  },

  // What failure patterns / where am I losing material
  {
    name: 'waste_patterns',
    match: re(/(failure|waste) pattern/i, /(where|why) (am i|are.*) (losing|wasting) (material|filament)/i, /print failures/i, /what.*went wrong/i),
    run: async () => {
      const a = api(); if (!a?.makerWastePatterns) return null;
      const list = await a.makerWastePatterns({ sinceDays: 30 }) as Array<{reason:string;count:number;total_qty:number;total_cost:number}>;
      if (!list?.length) return "No waste logged in the last 30 days. ✓";
      const out = [`**Waste patterns — last 30 days:**`, ''];
      let totalCost = 0;
      list.forEach(p => {
        totalCost += p.total_cost || 0;
        out.push(`• **${p.reason}** — ${p.count}× (${fmtMoney(p.total_cost)})`);
      });
      out.push('', `**Total waste cost: ${fmtMoney(totalCost)}**`);
      return out.join('\n');
    },
  },

  // What tasks today / due
  {
    name: 'tasks_today',
    match: re(/what tasks (do i|are)/i, /(my )?tasks (today|right now)/i, /what'?s on my (list|todo)/i, /^todo$/i),
    run: async () => {
      const a = api(); if (!a?.tasksList) return null;
      const list = await a.tasksList({ status: 'pending' }) as Array<{title:string; due_at?:string; priority?:number}>;
      if (!list?.length) return "Your task list is clear. ✓";
      const sorted = [...list].sort((a, b) => (b.priority || 0) - (a.priority || 0));
      const out = [`**${sorted.length} open task${sorted.length===1?'':'s'}:**`, ''];
      sorted.slice(0, 15).forEach(t => {
        const due = t.due_at ? ` _(due ${t.due_at.slice(0, 10)})_` : '';
        out.push(`• ${t.title}${due}`);
      });
      if (sorted.length > 15) out.push(`\n_…and ${sorted.length - 15} more._`);
      return out.join('\n');
    },
  },

  // What reminders
  {
    name: 'reminders',
    match: re(/(my )?reminders?/i, /what'?s (due|upcoming)/i, /what.*remind.*me/i),
    run: async () => {
      const a = api();
      try {
        const list = await ((a as any)?.['remindersList']?.() ?? (window as any).electronAPI?.invoke?.('reminders:list')) as Array<{title:string;due_at:string;done:number}> | null;
        if (!list) return null;
        const open = list.filter(r => !r.done);
        if (!open.length) return "No active reminders. ✓";
        const out = [`**${open.length} reminder${open.length===1?'':'s'}:**`, ''];
        open.slice(0, 15).forEach(r => out.push(`• ${r.title} — ${new Date(r.due_at).toLocaleString()}`));
        return out.join('\n');
      } catch { return null; }
    },
  },

  // What journal entries / show recent journal
  {
    name: 'journal_recent',
    match: re(/(show |my )?recent journal/i, /journal entries?/i, /what did i journal/i),
    run: async () => {
      try {
        const list = await (window as any).electronAPI?.invoke?.('journal:list') as Array<{date:string;title?:string;mood?:string}> | null;
        if (!list?.length) return "No journal entries yet.";
        const out = [`**Recent journal entries:**`, ''];
        list.slice(0, 10).forEach(j => {
          const title = j.title ? ` — ${j.title}` : '';
          const mood = j.mood ? ` _(${j.mood})_` : '';
          out.push(`• ${j.date}${title}${mood}`);
        });
        return out.join('\n');
      } catch { return null; }
    },
  },

  // Verse of the day — entirely local lookup
  {
    name: 'verse_today',
    match: re(/verse (of|for) (the )?day/i, /today'?s verse/i, /daily verse/i, /scripture for today/i),
    run: async () => {
      try {
        const VERSES = [
          'Proverbs 3:5-6', 'Philippians 4:13', 'Romans 8:28', 'Psalm 23:1',
          'Joshua 1:9', 'Isaiah 40:31', 'Jeremiah 29:11', 'Matthew 6:33',
          'John 3:16', '2 Corinthians 5:17', '1 Corinthians 13:4-7', 'Psalm 46:10',
        ];
        const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
        const ref = VERSES[dayOfYear % VERSES.length];
        const a = api();
        const v = await a?.scriptureLookup?.(ref) as { reference?:string; text?:string } | null;
        if (v?.text) return `**Verse for today — ${v.reference || ref}:**\n\n${v.text}`;
        return `**Today's verse:** ${ref}\n\n_(Import the KJV in Settings → Scripture to see the full text right here.)_`;
      } catch { return null; }
    },
  },
];

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Try to answer a user query locally. Returns { handled: true, reply } if any
 * intent matches, otherwise { handled: false }.
 *
 * Call this BEFORE invoking the AI in ChatView. If handled, render the reply
 * directly as the assistant message and skip the Groq round-trip.
 */
export async function routeLocally(query: string): Promise<LocalRouteResult> {
  const q = (query || '').trim();
  if (!q || q.length < 2) return { handled: false };

  for (const intent of INTENTS) {
    if (intent.match(q)) {
      try {
        const reply = await intent.run();
        if (reply) return { handled: true, reply, intentName: intent.name };
      } catch (e) {
        console.warn(`[localRouter] intent "${intent.name}" failed:`, e);
        // fall through to AI
      }
    }
  }
  return { handled: false };
}

/** Returns the names of all registered intents — for debugging / settings UI */
export function listLocalIntents(): string[] {
  return INTENTS.map(i => i.name);
}
