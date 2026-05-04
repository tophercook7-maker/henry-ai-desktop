/**
 * Henry Secretary Panel
 * AI-powered executive assistant — drafts emails, prepares meeting briefs,
 * manages follow-ups, summarizes conversations for action items
 */
import { useState, useRef } from 'react';
import { useStore } from '../../store';

const api = (window as any).henryAPI;

type SecTab = 'draft' | 'brief' | 'followup' | 'summary';

const TEMPLATES = {
  draft: [
    { label: 'Professional email', prompt: 'Write a professional email to ' },
    { label: 'Follow-up email', prompt: 'Write a follow-up email to ' },
    { label: 'Proposal email', prompt: 'Write a proposal email about ' },
    { label: 'Thank you email', prompt: 'Write a thank you email to ' },
    { label: 'Decline politely', prompt: 'Write a polite decline email for ' },
    { label: 'Request meeting', prompt: 'Write an email to request a meeting with ' },
  ],
  brief: [
    { label: 'Meeting brief', prompt: 'Prepare a one-page brief for my meeting about ' },
    { label: 'Client overview', prompt: 'Prepare a background brief on my client ' },
    { label: 'Project status', prompt: 'Prepare a project status brief for ' },
    { label: 'Research summary', prompt: 'Summarize research on ' },
  ],
  followup: [
    { label: 'After meeting', prompt: 'Draft follow-up items after my meeting about ' },
    { label: 'Action items', prompt: 'Extract and format the action items from: ' },
    { label: 'Next steps', prompt: 'Draft a next steps summary for ' },
  ],
  summary: [
    { label: 'Summarize text', prompt: 'Summarize this for me: ' },
    { label: 'Key points', prompt: 'Extract the key points from: ' },
    { label: 'Action items', prompt: 'Extract action items and decisions from: ' },
    { label: 'One sentence', prompt: 'Summarize in one sentence: ' },
  ],
};

const TAB_LABELS: Record<SecTab, string> = {
  draft: '✉️ Draft',
  brief: '📋 Brief',
  followup: '🔄 Follow-up',
  summary: '📄 Summary',
};

const PROXY_URL = 'https://henry-proxy.henryai.workers.dev';

async function callHenryAI(prompt: string, context: string, settings: Record<string,string>, providers: any[]): Promise<string> {
  const groq = providers?.find((p:any) => p.id === 'groq');
  const apiKey = groq?.apiKey || (groq as any)?.api_key || '';
  const model = settings?.companion_model || 'llama-3.3-70b-versatile';
  const systemPrompt = 'You are Henry, a professional executive assistant. Write clearly and professionally. Be concise. Format output in clean paragraphs. For emails include Subject: line. For briefs use clear sections.';
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt + (context ? '\n\nContext/Details:\n' + context : '') }
  ];

  // Use personal key if available, else fall back to proxy
  const useProxy = !apiKey || apiKey.length < 10;
  const url = useProxy ? PROXY_URL + '/v1/chat' : 'https://api.groq.com/openai/v1/chat/completions';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (useProxy) {
    const deviceId = (() => { let id = localStorage.getItem('henry:device_id'); if (!id) { id = crypto.randomUUID(); localStorage.setItem('henry:device_id', id); } return id; })();
    headers['X-Henry-Device'] = deviceId;
  } else {
    headers['Authorization'] = 'Bearer ' + apiKey;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: useProxy ? 'llama-3.1-8b-instant' : model, messages, max_tokens: 1200, temperature: 0.6 })
  });

  if (!res.ok) {
    if (res.status === 429) return '⚠️ Daily AI limit reached. Add your Groq key in Settings → AI Providers for unlimited use.';
    throw new Error('API error: ' + res.status);
  }
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices?.[0]?.message?.content || '(no response)';
}

export default function SecretaryPanel() {
  const { settings, providers, setCurrentView } = useStore();
  const [tab, setTab] = useState<SecTab>('draft');
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLTextAreaElement>(null);

  async function generate() {
    if (!prompt.trim()) return;
    setLoading(true); setOutput('');
    try {
      const result = await callHenryAI(prompt, context, settings, providers);
      setOutput(result);
    } catch (e) {
      setOutput('Error: ' + (e instanceof Error ? e.message : String(e)));
    }
    setLoading(false);
  }

  function applyTemplate(tmplPrompt: string) {
    setPrompt(tmplPrompt);
    document.getElementById('prompt-input')?.focus();
  }

  function copyOutput() {
    navigator.clipboard?.writeText(output).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function sendToChat() {
    import('../../actions/store/chatBridgeStore').then(({ sendToHenry }) => {
      sendToHenry(prompt + (context ? '\n\n' + context : ''));
      setCurrentView('chat');
    });
  }

  const inputCls = "w-full bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2.5 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 transition-colors resize-none";

  return (
    <div className="flex flex-col h-full bg-henry-bg overflow-y-auto">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-henry-border/20 flex-shrink-0">
        <h1 className="text-lg font-bold text-henry-text">Secretary</h1>
        <p className="text-[11px] text-henry-text-muted mt-0.5">Draft emails, prepare briefs, extract action items</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 py-3 border-b border-henry-border/20 flex-shrink-0">
        {(Object.keys(TAB_LABELS) as SecTab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setPrompt(''); setContext(''); setOutput(''); }}
            className={'text-[12px] px-3 py-1.5 rounded-lg font-medium transition-all ' +
              (tab===t ? 'bg-henry-accent text-white' : 'bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text')}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 px-6 py-4 space-y-4 max-w-2xl">
        {/* Template chips */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-2">Quick start</p>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES[tab].map(t => (
              <button key={t.label} onClick={() => applyTemplate(t.prompt)}
                className="text-[11px] px-3 py-1.5 rounded-full bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-accent hover:border-henry-accent/40 transition-all">
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Prompt */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-1.5 block">
            {tab === 'draft' ? 'What should I draft?' : tab === 'brief' ? 'What should I prepare a brief for?' : tab === 'followup' ? 'Follow up on what?' : 'What should I summarize?'}
          </label>
          <textarea id="prompt-input" value={prompt} onChange={e => setPrompt(e.target.value)} rows={2}
            placeholder={tab === 'draft' ? 'e.g. "Write a follow-up email to John Smith about the web design proposal"' :
              tab === 'brief' ? 'e.g. "Prepare a brief for my Monday meeting with the MixedMaker client"' :
              tab === 'followup' ? 'e.g. "Action items from my call with the marketing team"' :
              'e.g. "Summarize this client contract"'}
            className={inputCls} />
        </div>

        {/* Context */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-1.5 block">
            Context / paste text here (optional)
          </label>
          <textarea value={context} onChange={e => setContext(e.target.value)} rows={4}
            placeholder="Paste emails, notes, meeting transcripts, or any relevant context…"
            className={inputCls} />
        </div>

        {/* Generate button */}
        <div className="flex gap-2">
          <button onClick={generate} disabled={loading || !prompt.trim()}
            className="flex-1 py-3 rounded-xl bg-henry-accent text-white font-bold text-sm hover:bg-henry-accent/80 disabled:opacity-40 transition-all">
            {loading ? 'Henry is writing…' : `Generate ${tab === 'draft' ? 'Draft' : tab === 'brief' ? 'Brief' : tab === 'followup' ? 'Follow-up' : 'Summary'}`}
          </button>
          <button onClick={sendToChat} className="px-4 py-3 rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted text-sm hover:text-henry-text transition-all">
            Chat →
          </button>
        </div>

        {/* Output */}
        {output && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-wider text-henry-text-muted">Output</p>
              <div className="flex gap-2">
                <button onClick={copyOutput} className={'text-[11px] px-3 py-1 rounded-lg border transition-all ' + (copied ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'border-henry-border/30 text-henry-text-muted hover:text-henry-text')}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
                <button onClick={() => setOutput('')} className="text-[11px] px-2 py-1 rounded-lg text-henry-text-muted hover:text-red-400 transition-all">✕</button>
              </div>
            </div>
            <textarea ref={outputRef} value={output} onChange={e => setOutput(e.target.value)} rows={14}
              className={inputCls + ' font-mono text-xs leading-relaxed'} />
          </div>
        )}
      </div>
    </div>
  );
}
