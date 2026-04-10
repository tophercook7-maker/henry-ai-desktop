import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useStore } from '../../store';
import type { HenryLeanMemoryParts, Message } from '../../types';
import ChatInput from './ChatInput';
import EngineSelector from './EngineSelector';
import ScriptureToolsPanel from './ScriptureToolsPanel';
import MemoryAwarenessPanel from './MemoryAwarenessPanel';
import Design3DReferencePanel from './Design3DReferencePanel';
import WriterDraftLibrary from './WriterDraftLibrary';
import CreateTaskFromMessageModal from './CreateTaskFromMessageModal';
import WorkspaceContextStrip from './WorkspaceContextStrip';
import ExportPackBuilder from './ExportPackBuilder';
import MessageBubble from './MessageBubble';
import {
  buildCompanionStreamSystemPrompt,
  HENRY_OPERATING_MODES,
  type HenryOperatingMode,
  isHenryOperatingMode,
} from '@/henry/charter';
import {
  buildHenryMemoryContextBlock,
  capMessageContent,
  HENRY_MEMORY_CAPS,
  sliceRecentThreadMessages,
} from '@/henry/memoryContext';
import {
  BIBLE_SOURCE_PROFILES,
  DEFAULT_BIBLICAL_SOURCE_PROFILE_ID,
  type BibleSourceProfileId,
  getBibleSourceProfile,
  isBibleSourceProfileId,
} from '@/henry/biblicalProfiles';
import {
  DEFAULT_WRITER_DOCUMENT_TYPE_ID,
  WRITER_DOCUMENT_TYPES,
  type WriterDocumentTypeId,
  getWriterDocumentType,
  isWriterDocumentTypeId,
} from '@/henry/documentTypes';
import { defaultWriterDraftRelativePath } from '@/henry/documentFilename';
import { prependWriterDraftMetadata } from '@/henry/writerDraftMetadata';
import {
  HENRY_WRITER_CONTEXT_CHANGED_EVENT,
  readWriterActiveDraftPath,
  setWriterActiveDraftPath,
} from '@/henry/writerDraftContext';
import {
  DEFAULT_DESIGN3D_WORKFLOW_TYPE_ID,
  DESIGN3D_WORKFLOW_TYPES,
  type Design3DWorkflowTypeId,
  getDesign3DWorkflowType,
  isDesign3DWorkflowTypeId,
} from '@/henry/design3dTypes';
import { defaultDesign3DPlanRelativePath } from '@/henry/design3dFilename';
import { prependDesign3dPlanMetadata } from '@/henry/design3dPlanMetadata';
import {
  buildDesign3dReferenceFilesNote,
  clearDesign3dReferencePath,
  HENRY_DESIGN3D_REF_CHANGED_EVENT,
  readLastWorkspaceFilePath,
} from '@/henry/design3dReferenceContext';
import {
  formatScriptureLookupForPrompt,
  lookupScriptureFromUserMessage,
} from '@/henry/scriptureLookup';
import {
  buildSuggestedTaskFromMessage,
  resolveWorkspaceLinkageForTask,
  shouldOfferCreateTaskFromMessage,
} from '@/henry/taskFromMessage';
import type { ActiveWorkspaceContext } from '@/henry/workspaceContext';
import {
  buildWorkspaceContextPromptSection,
  clearActiveWorkspaceContext,
  findIndexHintForContext,
  HENRY_WORKSPACE_CONTEXT_CHANGED_EVENT,
  readActiveWorkspaceContext,
} from '@/henry/workspaceContext';
import type { ExportPresetId } from '@/henry/exportBundle';
import {
  checkSessionPathsStale,
  clearRecoveryBannerDismissedThisSession,
  clearSavedSessionResume,
  readSavedSessionResume,
  recoveryBannerDismissedThisAppSession,
  saveSessionResumeSnapshot,
  setRecoveryBannerDismissedThisSession,
  type SavedSessionStateV1,
  type SessionPathStaleReport,
} from '@/henry/sessionResume';
import { parseUserCommandLine, type HenryCommand } from '@/henry/commandLayer';
import { resolveHenryCommand } from '@/henry/commandActions';
import {
  webSearch,
  formatSearchResultsForHenry,
  fetchPageContent,
  formatPageContentForHenry,
  autoShouldSearch,
  extractUrlsFromText,
  getSearchApiKeys,
} from '@/henry/webSearch';
import { logAction } from '@/henry/auditLog';
import { extractHtmlFromMessage } from '@/henry/builderPreview';
import BuilderPreviewPanel from './BuilderPreviewPanel';

const HENRY_OPERATING_MODE_KEY = 'henry_operating_mode';
const HENRY_BIBLICAL_PROFILE_KEY = 'henry_biblical_source_profile';
const HENRY_WRITER_DOCUMENT_TYPE_KEY = 'henry_writer_document_type';
const HENRY_DESIGN3D_WORKFLOW_KEY = 'henry_design3d_workflow_type';

function readStoredOperatingMode(): HenryOperatingMode {
  try {
    const raw = localStorage.getItem(HENRY_OPERATING_MODE_KEY);
    if (raw && isHenryOperatingMode(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 'companion';
}

function readStoredBiblicalProfile(): BibleSourceProfileId {
  try {
    const raw = localStorage.getItem(HENRY_BIBLICAL_PROFILE_KEY);
    if (raw && isBibleSourceProfileId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_BIBLICAL_SOURCE_PROFILE_ID;
}

function readStoredWriterDocumentType(): WriterDocumentTypeId {
  try {
    const raw = localStorage.getItem(HENRY_WRITER_DOCUMENT_TYPE_KEY);
    if (raw && isWriterDocumentTypeId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_WRITER_DOCUMENT_TYPE_ID;
}

function readStoredDesign3dWorkflow(): Design3DWorkflowTypeId {
  try {
    const raw = localStorage.getItem(HENRY_DESIGN3D_WORKFLOW_KEY);
    if (raw && isDesign3DWorkflowTypeId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_DESIGN3D_WORKFLOW_TYPE_ID;
}

const MODE_HUMAN_LABELS: Record<HenryOperatingMode, string> = {
  companion: 'Chat',
  writer: 'Writing',
  biblical: 'Bible Study',
  developer: 'Code',
  builder: 'App Builder',
  design3d: '3D / Design',
  computer: 'Computer',
  secretary: 'Secretary',
};

const BIBLICAL_BOOKS = [
  'genesis','exodus','leviticus','numbers','deuteronomy','joshua','judges','ruth',
  'samuel','kings','chronicles','ezra','nehemiah','esther','job','psalm','psalms',
  'proverbs','ecclesiastes','isaiah','jeremiah','lamentations','ezekiel','daniel',
  'hosea','joel','amos','obadiah','jonah','micah','nahum','habakkuk','zephaniah',
  'haggai','zechariah','malachi','matthew','mark','luke','john','acts','romans',
  'corinthians','galatians','ephesians','philippians','colossians','thessalonians',
  'timothy','titus','philemon','hebrews','james','peter','jude','revelation',
  'tobit','judith','maccabees','sirach','wisdom','baruch',
];

const BIBLE_ABBR_PATTERN = /\b(gen|exo|lev|num|deu|jos|jdg|rut|sam|kgs|chr|ezr|neh|est|job|psa|pro|ecc|isa|jer|lam|eze|dan|hos|joe|amo|oba|jon|mic|nah|hab|zep|hag|zec|mal|mat|mar|luk|joh|act|rom|cor|gal|eph|phi|col|the|tim|tit|phm|heb|jam|pet|jud|rev)\w*\.?\s+\d+/i;

function detectModeFromMessage(text: string, currentMode: HenryOperatingMode): HenryOperatingMode {
  const lower = text.toLowerCase();

  const biblicalWords = ['verse','scripture','bible','biblical','gospel','sermon','prayer',
    'theology','orthodox','ethiopian orthodox','fasting','liturgy','lent','holy spirit',
    'trinity','resurrection','baptism','saint','saints','prophet','epistle','testament',
    'covenant','church fathers','apostle','disciple','amen','hallelujah'];

  const devKeywords = ['debug','bug','error','function','programming','python','javascript',
    'typescript','html','css','react','api','database','algorithm','variable','syntax',
    'compiler','git','github','software','terminal','command','script','loop','array',
    'class','method','exception','null','undefined','import','export','package'];

  const writerPhrases = ['write a','write an','draft a','draft an','help me write',
    'write me a','write me an','give me an essay','an essay about','a letter to',
    'an email to','a story about','a poem about','a report on','an outline for',
    'proofread','edit my writing','cover letter'];

  const designKeywords = ['3d model','blender','room layout','floor plan','architecture',
    'interior design','render','blueprint','furniture layout','kitchen layout',
    'bedroom layout','home office','workspace design','3d print','cad '];

  const secretaryPhrases = ['draft an email','draft email','write an email','send an email',
    'schedule a meeting','schedule meeting','book a meeting','my calendar','my schedule',
    'daily briefing','morning briefing','weekly briefing','meeting prep','prep for',
    'follow up','follow-up','action items','task list','triage my tasks','remind me',
    'out of office','reschedule','cancel my','meeting agenda','who do i owe','waiting on'];

  const computerPhrases = ['run a command','run the command','open the terminal','shell command',
    'bash script','applescript','take a screenshot','screenshot my','open the app',
    'launch the app','automate my','run this script','execute','system command',
    'find the file','move the file','delete the file','computer control'];

  const builderPhrases = ['build a website','build a web app','build an app','build me a',
    'create a website','create a web app','create an app','make a website','make a web app',
    'make me a website','make me an app','landing page','build a landing','build a dashboard',
    'build a tool','build a form','build a game','build a calculator','build a timer',
    'build a portfolio','build me a portfolio','design a website','design a web app',
    'build a todo','build a task','build a budget','build a habit tracker'];

  if (BIBLE_ABBR_PATTERN.test(text)) return 'biblical';
  if (BIBLICAL_BOOKS.some((b) => lower.includes(b))) return 'biblical';
  if (biblicalWords.some((w) => lower.includes(w))) return 'biblical';

  if (builderPhrases.some((p) => lower.includes(p))) return 'builder';

  if (designKeywords.some((k) => lower.includes(k))) return 'design3d';

  if (secretaryPhrases.some((p) => lower.includes(p))) return 'secretary';

  if (computerPhrases.some((p) => lower.includes(p))) return 'computer';

  if (writerPhrases.some((p) => lower.includes(p))) return 'writer';

  // Code detection — require multiple signals or specific code keywords to avoid false positives
  const devMatches = devKeywords.filter((k) => lower.includes(k)).length;
  if (devMatches >= 2 || (devMatches >= 1 && /[{}\[\]()=>]|```/.test(text))) return 'developer';

  return currentMode;
}

function exportPresetForOperatingMode(mode: HenryOperatingMode): ExportPresetId {
  if (mode === 'writer') return 'writer_handoff';
  if (mode === 'design3d') return 'design3d_handoff';
  if (mode === 'biblical') return 'biblical_study_pack';
  if (mode === 'builder') return 'mixed_workspace';
  return 'mixed_workspace';
}

function resumeModeLabel(m: HenryOperatingMode): string {
  if (m === 'design3d') return '3D / design';
  return m.charAt(0).toUpperCase() + m.slice(1);
}

export default function ChatView() {
  const {
    messages,
    activeConversationId,
    setActiveConversation,
    addMessage,
    updateMessage,
    setMessages,
    isStreaming,
    setIsStreaming,
    streamingContent,
    setStreamingContent,
    appendStreamingContent,
    companionStatus,
    setCompanionStatus,
    setWorkerStatus,
    settings,
    conversations,
    tasks,
  } = useStore();

  const [selectedEngine, setSelectedEngine] = useState<'companion' | 'worker'>('companion');
  const [operatingMode, setOperatingMode] = useState<HenryOperatingMode>(readStoredOperatingMode);
  const [biblicalSourceProfileId, setBiblicalSourceProfileId] =
    useState<BibleSourceProfileId>(readStoredBiblicalProfile);
  const [writerDocumentTypeId, setWriterDocumentTypeId] = useState<WriterDocumentTypeId>(
    readStoredWriterDocumentType
  );
  const [design3dWorkflowTypeId, setDesign3dWorkflowTypeId] = useState<Design3DWorkflowTypeId>(
    readStoredDesign3dWorkflow
  );
  const [saveWorkspaceDraftBusy, setSaveWorkspaceDraftBusy] = useState(false);
  const [chatInject, setChatInject] = useState<{ id: number; text: string } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    try { return localStorage.getItem('henry_tts_enabled') === 'true'; } catch { return false; }
  });
  const lastSpokenMsgIdRef = useRef<string | null>(null);
  const [design3dRefPath, setDesign3dRefPath] = useState<string | null>(() =>
    readLastWorkspaceFilePath()
  );
  const [writerActiveDraftPath, setWriterActiveDraftPathState] = useState<string | null>(() =>
    readWriterActiveDraftPath()
  );
  const [createTaskFromMessage, setCreateTaskFromMessage] = useState<Message | null>(null);
  const [activeWorkspaceContext, setActiveWorkspaceContextState] = useState<ActiveWorkspaceContext | null>(
    () => readActiveWorkspaceContext()
  );
  const [workspaceContextIndexHint, setWorkspaceContextIndexHint] = useState<string | null>(null);
  const [exportPackOpen, setExportPackOpen] = useState(false);
  const [exportPackPreset, setExportPackPreset] = useState<ExportPresetId>('mixed_workspace');
  const [exportPackSession, setExportPackSession] = useState(0);
  const [recoverySnapshot, setRecoverySnapshot] = useState<SavedSessionStateV1 | null>(null);
  const [recoveryBannerOpen, setRecoveryBannerOpen] = useState(false);
  const [recoveryStale, setRecoveryStale] = useState<SessionPathStaleReport | null>(null);
  const [recoveryConvRestored, setRecoveryConvRestored] = useState(false);
  const [recoveryConvMissing, setRecoveryConvMissing] = useState(false);
  const [memoryPanelSessionHint, setMemoryPanelSessionHint] = useState(false);
  const [autoSwitchNotice, setAutoSwitchNotice] = useState<string | null>(null);
  const [builderPreviewHtml, setBuilderPreviewHtml] = useState<string | null>(null);
  const [builderPreviewOpen, setBuilderPreviewOpen] = useState(false);
  const autoSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<any>(null);
  const sessionAsyncResumeStartedRef = useRef(false);
  const wakeHandleSendRef = useRef<((content: string) => void) | null>(null);

  useEffect(() => {
    function handleSecretaryPrompt(e: Event) {
      const detail = (e as CustomEvent<{ prompt: string; mode?: string }>).detail;
      const mode = detail.mode && isHenryOperatingMode(detail.mode) ? detail.mode : 'secretary';
      setOperatingMode(mode);
      if (detail.prompt) {
        setChatInject({ id: Date.now(), text: detail.prompt });
      }
    }
    function handleModeLaunch(e: Event) {
      const detail = (e as CustomEvent<{ mode: string; prompt: string }>).detail;
      const mode = detail.mode && isHenryOperatingMode(detail.mode) ? detail.mode : 'companion';
      setOperatingMode(mode);
      if (detail.prompt) {
        setChatInject({ id: Date.now(), text: detail.prompt });
      }
    }
    function handleNewChat() {
      clearSavedSessionResume();
      clearRecoveryBannerDismissedThisSession();
      setActiveConversation(null);
      setMessages([]);
      setOperatingMode('companion');
      setRecoveryBannerOpen(false);
      setRecoverySnapshot(null);
    }
    function handleWakeWord(e: Event) {
      const { query } = (e as CustomEvent<{ query: string }>).detail;
      useStore.getState().setCurrentView('chat');
      setOperatingMode('companion');
      const text = query?.trim() || 'Hey.';
      setTimeout(() => {
        wakeHandleSendRef.current?.(text);
      }, 80);
    }

    window.addEventListener('henry_secretary_prompt', handleSecretaryPrompt);
    window.addEventListener('henry_mode_launch', handleModeLaunch);
    window.addEventListener('henry_new_chat', handleNewChat);
    window.addEventListener('henry_wake_word', handleWakeWord);
    return () => {
      window.removeEventListener('henry_secretary_prompt', handleSecretaryPrompt);
      window.removeEventListener('henry_mode_launch', handleModeLaunch);
      window.removeEventListener('henry_new_chat', handleNewChat);
      window.removeEventListener('henry_wake_word', handleWakeWord);
    };
  }, []);

  // Worker Brain: inject Worker messages back into the active conversation
  useEffect(() => {
    if (!window.henryAPI.onWorkerMessage) return;
    const unsub = window.henryAPI.onWorkerMessage((msg) => {
      if (msg.conversation_id === activeConversationId) {
        addMessage(msg);
        setWorkerStatus({ status: 'idle' });
      }
    });
    return unsub;
  }, [activeConversationId]);

  // Startup: auto-detect best Ollama models if none are set yet
  useEffect(() => {
    void (async () => {
      try {
        const s = useStore.getState().settings;
        const provs = await window.henryAPI.getProviders();
        const ollamaEnabled = provs.some((p: any) => p.id === 'ollama' && p.enabled);
        if (!ollamaEnabled) return;
        if (s.companion_model) return; // already configured, don't override

        const { autoSelectModels } = await import('@/henry/modelPriority');
        const ollamaUrl = s.ollama_base_url || 'http://localhost:11434';
        const raw = await window.henryAPI.ollamaModels(ollamaUrl) as any;
        const installed: string[] = (raw?.models ?? []).map((m: any) => m.name as string);
        if (!installed.length) return;

        const best = autoSelectModels(installed);
        if (best.companion) {
          await window.henryAPI.saveSetting('companion_model', best.companion.id);
          await window.henryAPI.saveSetting('companion_provider', 'ollama');
          useStore.getState().updateSetting('companion_model', best.companion.id);
          useStore.getState().updateSetting('companion_provider', 'ollama');
        }
        if (best.companionFallback) {
          await window.henryAPI.saveSetting('companion_model_2', best.companionFallback.id);
          await window.henryAPI.saveSetting('companion_provider_2', 'ollama');
          useStore.getState().updateSetting('companion_model_2', best.companionFallback.id);
          useStore.getState().updateSetting('companion_provider_2', 'ollama');
        }
        if (best.worker) {
          await window.henryAPI.saveSetting('worker_model', best.worker.id);
          await window.henryAPI.saveSetting('worker_provider', 'ollama');
          useStore.getState().updateSetting('worker_model', best.worker.id);
          useStore.getState().updateSetting('worker_provider', 'ollama');
        }
      } catch {
        // Auto-detect is best-effort — silently skip if Ollama isn't reachable
      }
    })();
  }, []);

  // TTS: speak Henry's response when streaming ends
  useEffect(() => {
    if (!ttsEnabled || isStreaming) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') return;
    if (lastSpokenMsgIdRef.current === lastMsg.id) return;
    lastSpokenMsgIdRef.current = lastMsg.id;
    window.speechSynthesis.cancel();
    const clean = lastMsg.content
      .replace(/```[\s\S]*?```/g, 'code block')
      .replace(/`[^`]+`/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/>\s+/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .trim();
    if (!clean) return;
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 0.92;
    utterance.pitch = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) => v.name === 'Samantha' || v.name === 'Daniel' || v.name.includes('Google') || v.lang === 'en-US'
    );
    if (preferred) utterance.voice = preferred;
    window.speechSynthesis.speak(utterance);
  }, [isStreaming, ttsEnabled, messages]);

  function toggleTts() {
    const next = !ttsEnabled;
    setTtsEnabled(next);
    try { localStorage.setItem('henry_tts_enabled', String(next)); } catch { /* ignore */ }
    if (!next) window.speechSynthesis.cancel();
  }

  /** Restore active thread id before persistence effects run (avoids wiping saved conversation). */
  useLayoutEffect(() => {
    if (!conversations.length) return;
    const saved = readSavedSessionResume();
    if (!saved?.lastConversationId) return;
    if (!conversations.some((c) => c.id === saved.lastConversationId)) return;
    const cur = useStore.getState().activeConversationId;
    if (cur && cur !== saved.lastConversationId) return;
    useStore.getState().setActiveConversation(saved.lastConversationId);
  }, [conversations]);

  useEffect(() => {
    saveSessionResumeSnapshot({
      lastConversationId: activeConversationId,
      operatingMode,
      biblicalSourceProfileId,
      writerDocumentTypeId,
      design3dWorkflowTypeId,
      writerActiveDraftPath,
      design3dReferencePath: design3dRefPath,
      activeWorkspaceContext,
    });
  }, [
    activeConversationId,
    operatingMode,
    biblicalSourceProfileId,
    writerDocumentTypeId,
    design3dWorkflowTypeId,
    writerActiveDraftPath,
    design3dRefPath,
    activeWorkspaceContext,
  ]);

  useEffect(() => {
    if (!conversations.length) return;
    if (sessionAsyncResumeStartedRef.current) return;
    sessionAsyncResumeStartedRef.current = true;

    void (async () => {
      const saved = readSavedSessionResume();
      if (!saved) return;

      const stale = await checkSessionPathsStale(saved, (p) => window.henryAPI.pathExists(p));
      setRecoveryStale(stale);

      const st = useStore.getState();
      let restored = false;
      let missing = false;
      if (saved.lastConversationId) {
        if (st.conversations.some((c) => c.id === saved.lastConversationId)) {
          try {
            const msgs = await window.henryAPI.getMessages(saved.lastConversationId);
            st.setMessages(msgs);
            restored = true;
          } catch {
            missing = true;
          }
        } else {
          missing = true;
        }
      }

      setRecoveryConvRestored(restored);
      setRecoveryConvMissing(missing);
      setRecoverySnapshot(saved);
      setMemoryPanelSessionHint(true);
      if (!recoveryBannerDismissedThisAppSession()) {
        setRecoveryBannerOpen(true);
      }
    })();
  }, [conversations.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  useEffect(() => {
    try {
      localStorage.setItem(HENRY_OPERATING_MODE_KEY, operatingMode);
    } catch {
      /* ignore */
    }
  }, [operatingMode]);

  useEffect(() => {
    try {
      localStorage.setItem(HENRY_BIBLICAL_PROFILE_KEY, biblicalSourceProfileId);
    } catch {
      /* ignore */
    }
  }, [biblicalSourceProfileId]);

  useEffect(() => {
    try {
      localStorage.setItem(HENRY_WRITER_DOCUMENT_TYPE_KEY, writerDocumentTypeId);
    } catch {
      /* ignore */
    }
  }, [writerDocumentTypeId]);

  useEffect(() => {
    try {
      localStorage.setItem(HENRY_DESIGN3D_WORKFLOW_KEY, design3dWorkflowTypeId);
    } catch {
      /* ignore */
    }
  }, [design3dWorkflowTypeId]);

  useEffect(() => {
    const sync = () => setDesign3dRefPath(readLastWorkspaceFilePath());
    window.addEventListener(HENRY_DESIGN3D_REF_CHANGED_EVENT, sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener(HENRY_DESIGN3D_REF_CHANGED_EVENT, sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  useEffect(() => {
    const sync = () => setWriterActiveDraftPathState(readWriterActiveDraftPath());
    window.addEventListener(HENRY_WRITER_CONTEXT_CHANGED_EVENT, sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener(HENRY_WRITER_CONTEXT_CHANGED_EVENT, sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  useEffect(() => {
    const sync = () => setActiveWorkspaceContextState(readActiveWorkspaceContext());
    window.addEventListener(HENRY_WORKSPACE_CONTEXT_CHANGED_EVENT, sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener(HENRY_WORKSPACE_CONTEXT_CHANGED_EVENT, sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  useEffect(() => {
    if (!activeWorkspaceContext) setWorkspaceContextIndexHint(null);
  }, [activeWorkspaceContext]);

  function openExportPack(preset: ExportPresetId) {
    setExportPackPreset(preset);
    setExportPackSession((k) => k + 1);
    setExportPackOpen(true);
  }

  const exportPackChatActionVisible =
    !!settings.workspace_path?.trim() ||
    !!activeWorkspaceContext ||
    !!writerActiveDraftPath ||
    !!design3dRefPath ||
    operatingMode !== 'companion' ||
    messages.length > 0;

  function handleRecoveryDismiss() {
    setRecoveryBannerOpen(false);
    setRecoveryBannerDismissedThisSession();
  }

  async function handleResumeLastThread() {
    const saved = readSavedSessionResume() ?? recoverySnapshot;
    const id = saved?.lastConversationId;
    if (!id || !conversations.some((c) => c.id === id)) return;
    setActiveConversation(id);
    try {
      const msgs = await window.henryAPI.getMessages(id);
      setMessages(msgs);
      setRecoveryConvMissing(false);
      setRecoveryConvRestored(true);
    } catch {
      /* keep banner honest */
    }
    setRecoveryBannerOpen(false);
    setRecoveryBannerDismissedThisSession();
  }

  function handleSessionStartClean() {
    clearSavedSessionResume();
    clearRecoveryBannerDismissedThisSession();
    setActiveConversation(null);
    setMessages([]);
    setOperatingMode('companion');
    setBiblicalSourceProfileId(DEFAULT_BIBLICAL_SOURCE_PROFILE_ID);
    setWriterDocumentTypeId(DEFAULT_WRITER_DOCUMENT_TYPE_ID);
    setDesign3dWorkflowTypeId(DEFAULT_DESIGN3D_WORKFLOW_TYPE_ID);
    clearActiveWorkspaceContext();
    clearDesign3dReferencePath();
    setWriterActiveDraftPath(null);
    setDesign3dRefPath(null);
    setWriterActiveDraftPathState(null);
    setActiveWorkspaceContextState(null);
    setRecoveryBannerOpen(false);
    setRecoverySnapshot(null);
    setRecoveryStale(null);
    setRecoveryConvRestored(false);
    setRecoveryConvMissing(false);
    setMemoryPanelSessionHint(false);
  }

  const recoveryThreadTitle =
    (activeConversationId && conversations.find((c) => c.id === activeConversationId)?.title) ||
    (recoverySnapshot?.lastConversationId &&
      conversations.find((c) => c.id === recoverySnapshot.lastConversationId)?.title) ||
    null;

  const bibleProfileRecovery = getBibleSourceProfile(biblicalSourceProfileId);

  async function handleSaveWriterDraft(markdown: string) {
    const root = settings.workspace_path?.trim();
    if (!root) {
      window.alert('Set a workspace folder in Settings before saving drafts.');
      return;
    }
    const suggested = defaultWriterDraftRelativePath(writerDocumentTypeId);
    const input = window.prompt('Save as path (relative to workspace):', suggested);
    if (input === null) return;
    const relPath = input.trim() || suggested;
    setSaveWorkspaceDraftBusy(true);
    try {
      const writerType = getWriterDocumentType(writerDocumentTypeId);
      const withMeta = prependWriterDraftMetadata(markdown, {
        documentTypeId: writerDocumentTypeId,
        documentTypeLabel: writerType?.label ?? writerDocumentTypeId,
        relativePath: relPath,
        workspaceHint: root,
      });
      await window.henryAPI.writeFile(relPath, withMeta);
      window.alert(`Saved to workspace:\n${relPath}`);
    } catch (e: unknown) {
      window.alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaveWorkspaceDraftBusy(false);
    }
  }

  async function handleSaveDesign3dPlan(markdown: string) {
    const root = settings.workspace_path?.trim();
    if (!root) {
      window.alert('Set a workspace folder in Settings before saving plans.');
      return;
    }
    const suggested = defaultDesign3DPlanRelativePath(design3dWorkflowTypeId);
    const input = window.prompt('Save as path (relative to workspace):', suggested);
    if (input === null) return;
    const relPath = input.trim() || suggested;
    setSaveWorkspaceDraftBusy(true);
    try {
      const withMeta = prependDesign3dPlanMetadata(markdown, {
        workflowId: design3dWorkflowTypeId,
        referencePath: design3dRefPath,
      });
      await window.henryAPI.writeFile(relPath, withMeta);
      window.alert(`Saved to workspace:\n${relPath}`);
    } catch (e: unknown) {
      window.alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaveWorkspaceDraftBusy(false);
    }
  }

  async function handleOperatorCommand(content: string, parsed: HenryCommand) {
    const outcome = resolveHenryCommand(parsed, {
      operatingMode,
      writerDocumentTypeId,
      design3dWorkflowTypeId,
      workspaceReady: !!settings.workspace_path?.trim(),
      activeWorkspaceContext,
    });

    let convId = activeConversationId;

    if (outcome.effects.newChat) {
      try {
        const convo = await window.henryAPI.createConversation('New conversation');
        convId = convo.id;
        setActiveConversation(convId);
        setMessages([]);
        const convos = await window.henryAPI.getConversations();
        useStore.getState().setConversations(convos);
      } catch (err) {
        console.error('Failed to start new conversation:', err);
        return;
      }
    } else if (!convId) {
      try {
        const convo = await window.henryAPI.createConversation(
          content.slice(0, 50) + (content.length > 50 ? '...' : '')
        );
        convId = convo.id;
        setActiveConversation(convId);
        const convos = await window.henryAPI.getConversations();
        useStore.getState().setConversations(convos);
      } catch (err) {
        console.error('Failed to create conversation:', err);
        return;
      }
    }

    if (outcome.effects.setOperatingMode) {
      setOperatingMode(outcome.effects.setOperatingMode);
    }
    if (outcome.effects.clearWriterDraft) {
      setWriterActiveDraftPath(null);
      setWriterActiveDraftPathState(null);
    }
    if (outcome.effects.clearDesign3dRef) {
      clearDesign3dReferencePath();
      setDesign3dRefPath(null);
    }
    if (outcome.effects.clearWorkspaceContext) {
      clearActiveWorkspaceContext();
      setActiveWorkspaceContextState(null);
    }
    if (outcome.effects.composerSeed) {
      setChatInject({ id: Date.now(), text: outcome.effects.composerSeed });
    }
    if (outcome.effects.openExportPackPreset) {
      openExportPack(outcome.effects.openExportPackPreset);
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: convId!,
      role: 'user',
      content,
      engine: selectedEngine,
      created_at: new Date().toISOString(),
    };
    addMessage(userMsg);
    try {
      await window.henryAPI.saveMessage(userMsg);
    } catch (err) {
      console.error('Failed to save command message:', err);
    }

    const ackContent = `*Henry (command)*\n\n${outcome.acknowledgement}`;
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: convId!,
      role: 'assistant',
      content: ackContent,
      engine: 'companion',
      created_at: new Date().toISOString(),
    };
    addMessage(assistantMsg);
    try {
      await window.henryAPI.saveMessage(assistantMsg);
    } catch (err) {
      console.error('Failed to save command acknowledgement:', err);
    }
  }

  async function handleSend(content: string) {
    if (!content.trim() || isStreaming) return;

    const parsedCmd = parseUserCommandLine(content);
    if (parsedCmd) {
      await handleOperatorCommand(content, parsedCmd);
      return;
    }

    // URL browse: if message is ONLY a URL, fetch the page and inject it as context
    const trimmed = content.trim();
    const urlMatch = trimmed.match(/^(https?:\/\/[^\s]+)(\s+(.+))?$/);
    if (urlMatch) {
      const url = urlMatch[1];
      const question = urlMatch[3]?.trim() || `Summarize the key information from this page.`;
      await handleBrowseUrl(url, question);
      return;
    }

    const engine = selectedEngine;

    // Auto-detect mode from message content (only for companion/chat engine)
    let detectedMode = operatingMode;
    if (engine !== 'worker') {
      detectedMode = detectModeFromMessage(content, operatingMode);
      if (detectedMode !== operatingMode) {
        setOperatingMode(detectedMode);
        const label = MODE_HUMAN_LABELS[detectedMode];
        setAutoSwitchNotice(label);
        if (autoSwitchTimerRef.current) clearTimeout(autoSwitchTimerRef.current);
        autoSwitchTimerRef.current = setTimeout(() => setAutoSwitchNotice(null), 4000);
      }
    }

    // Ensure we have a conversation
    let convId = activeConversationId;
    if (!convId) {
      try {
        const convo = await window.henryAPI.createConversation(
          content.slice(0, 50) + (content.length > 50 ? '...' : '')
        );
        convId = convo.id;
        setActiveConversation(convId);

        // Refresh conversations list
        const convos = await window.henryAPI.getConversations();
        useStore.getState().setConversations(convos);
      } catch (err) {
        console.error('Failed to create conversation:', err);
        return;
      }
    }

    // Add user message
    const userMsg = {
      id: crypto.randomUUID(),
      conversation_id: convId,
      role: 'user' as const,
      content,
      engine,
      created_at: new Date().toISOString(),
    };
    addMessage(userMsg);

    // Save user message to DB
    try {
      await window.henryAPI.saveMessage(userMsg);
    } catch (err) {
      console.error('Failed to save message:', err);
    }

    // Route based on engine
    if (engine === 'worker') {
      // Worker tasks go through the task queue
      await handleWorkerRequest(content, convId);
    } else {
      // Companion uses streaming directly — pass detectedMode so the prompt uses the right mode
      // even before React re-renders with the new operatingMode state
      await handleCompanionStream(content, convId, detectedMode);
    }
  }

  // Like handleSend but shows original user message in chat while sending enriched content to Henry
  async function handleSendEnriched(enrichedContent: string, displayContent: string) {
    const engine = selectedEngine;
    let detectedMode = operatingMode;
    if (engine !== 'worker') {
      detectedMode = detectModeFromMessage(displayContent, operatingMode);
      if (detectedMode !== operatingMode) {
        setOperatingMode(detectedMode);
        setAutoSwitchNotice(MODE_HUMAN_LABELS[detectedMode]);
        if (autoSwitchTimerRef.current) clearTimeout(autoSwitchTimerRef.current);
        autoSwitchTimerRef.current = setTimeout(() => setAutoSwitchNotice(null), 4000);
      }
    }
    let convId = activeConversationId;
    if (!convId) {
      try {
        const convo = await window.henryAPI.createConversation(displayContent.slice(0, 50) + (displayContent.length > 50 ? '...' : ''));
        convId = convo.id;
        setActiveConversation(convId);
        const convos = await window.henryAPI.getConversations();
        useStore.getState().setConversations(convos);
      } catch (err) {
        console.error('Failed to create conversation:', err);
        return;
      }
    }
    const userMsg = {
      id: crypto.randomUUID(),
      conversation_id: convId,
      role: 'user' as const,
      content: displayContent,
      engine,
      created_at: new Date().toISOString(),
    };
    addMessage(userMsg);
    try { await window.henryAPI.saveMessage(userMsg); } catch { /* optional */ }
    await handleCompanionStream(enrichedContent, convId, detectedMode);
  }

  async function autoNameConversation(
    convId: string,
    userMessage: string,
    assistantReply: string,
    providerName: string,
    model: string,
    apiKey: string
  ): Promise<void> {
    try {
      const prompt = `Here is the start of a conversation. Create a concise 4-6 word title for it.\nUser: ${userMessage.slice(0, 300)}\nAssistant: ${assistantReply.slice(0, 300)}`;
      const titleStream = window.henryAPI.streamMessage({
        provider: providerName,
        model,
        apiKey,
        messages: [
          { role: 'system', content: 'You name conversations with a crisp 4-6 word title. Output ONLY the title text, no quotes, no trailing punctuation.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      });
      titleStream.onChunk(() => { /* collect silently */ });
      titleStream.onDone(async (rawTitle: string) => {
        const clean = rawTitle.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?]+$/, '').slice(0, 60);
        if (clean.length >= 4) {
          try {
            await window.henryAPI.updateConversation(convId, clean);
            const convos = await window.henryAPI.getConversations();
            useStore.getState().setConversations(convos);
          } catch { /* silent */ }
        }
      });
      titleStream.onError(() => { /* silent */ });
    } catch { /* silent */ }
  }

  async function handleCompanionStream(content: string, convId: string, modeOverride?: HenryOperatingMode) {
    const effectiveMode = modeOverride ?? operatingMode;
    setIsStreaming(true);
    setStreamingContent('');
    setCompanionStatus({ status: 'thinking' });

    // Lean memory slices from DB (summary, facts, workspace hints); format in memoryContext.ts
    const emptyLean: HenryLeanMemoryParts = {
      conversationSummary: null,
      facts: [],
      workspaceHints: [],
    };
    let lean: HenryLeanMemoryParts = emptyLean;
    try {
      const ctx = await window.henryAPI.buildContext({
        conversationId: convId,
        query: content,
      });
      lean = ctx.lean;
    } catch {
      /* Memory context is optional */
    }

    const convTitle = conversations.find((c) => c.id === convId)?.title ?? null;
    const workspacePath = settings.workspace_path?.trim() || null;
    const bibleProfile = getBibleSourceProfile(biblicalSourceProfileId);
    const writerType = getWriterDocumentType(writerDocumentTypeId);
    const design3dType = getDesign3DWorkflowType(design3dWorkflowTypeId);
    const lastFile = effectiveMode === 'design3d' ? design3dRefPath : null;
    const design3dRefNote =
      effectiveMode === 'design3d' && lastFile
        ? buildDesign3dReferenceFilesNote([lastFile])
        : null;

    const wsCtx = activeWorkspaceContext;
    const wsIndexHint = wsCtx ? findIndexHintForContext(wsCtx, lean.workspaceHints) : null;
    setWorkspaceContextIndexHint(wsIndexHint);
    const wsBlock =
      wsCtx != null
        ? buildWorkspaceContextPromptSection(wsCtx, { indexSummaryHint: wsIndexHint })
        : '';

    let memoryContext = buildHenryMemoryContextBlock({
      mode: effectiveMode,
      lean,
      workspacePathHint: workspacePath,
      conversationTitle: convTitle,
      biblicalSourceProfileLabel:
        effectiveMode === 'biblical' ? bibleProfile?.label ?? null : null,
      writerDocumentTypeLabel:
        effectiveMode === 'writer' ? writerType?.label ?? null : null,
      design3dWorkflowLabel:
        effectiveMode === 'design3d' ? design3dType?.label ?? null : null,
      design3dReferenceNote: design3dRefNote,
      activeWorkspaceContextBlock: wsBlock || null,
    });

    if (effectiveMode === 'biblical') {
      try {
        const sl = await lookupScriptureFromUserMessage(content);
        if (sl) {
          const bp = getBibleSourceProfile(biblicalSourceProfileId);
          const scriptureBlock = formatScriptureLookupForPrompt(sl, {
            activeBibleProfileLabel: bp?.label ?? null,
            activeBibleProfileId: biblicalSourceProfileId,
          });
          memoryContext = [memoryContext.trim(), scriptureBlock].filter(Boolean).join('\n\n');
        }
      } catch {
        /* Local scripture lookup is optional */
      }
    }

    // Recent transcript only — capped count and per-message length (no full history dump).
    // Must read from the store here: `messages` from the hook is stale right after addMessage(userMsg).
    const threadMessagesLive = useStore.getState().messages.filter((m) => m.conversation_id === convId);
    const history = sliceRecentThreadMessages(
      threadMessagesLive.map((m) => ({
        role: m.role,
        content: capMessageContent(m.content, HENRY_MEMORY_CAPS.maxMessageCharsEach),
      })),
      HENRY_MEMORY_CAPS.maxRecentMessagesInTranscript
    );

    if (import.meta.env.DEV) {
      const last = history[history.length - 1];
      console.debug('[Henry] companion stream', {
        convId,
        historyCount: history.length,
        lastRole: last?.role,
        lastMessageMatchesSend: last?.role === 'user' && last?.content === content,
        provider: useStore.getState().settings.companion_provider,
        model: useStore.getState().settings.companion_model,
      });
    }

    // Get companion engine settings — try primary, fall back to companion_model_2 if set
    const providers = await window.henryAPI.getProviders();
    const s = useStore.getState().settings;
    let companionProvider = s.companion_provider;
    let companionModel = s.companion_model;
    const fallbackModel = s.companion_model_2;
    const fallbackProvider = s.companion_provider_2 || s.companion_provider;
    let provider = providers.find((p: any) => p.id === companionProvider);

    // If primary isn't configured but fallback is, use it
    if ((!provider || !companionModel) && fallbackModel && fallbackProvider) {
      companionProvider = fallbackProvider;
      companionModel = fallbackModel;
      provider = providers.find((p: any) => p.id === companionProvider);
    }

    if (!provider || !companionModel) {
      addMessage({
        id: crypto.randomUUID(),
        conversation_id: convId,
        role: 'assistant',
        content: '⚠️ No model configured. Go to Settings → Engines, click **Auto-detect** if you have Ollama running, or set a model manually.',
        engine: 'companion',
        created_at: new Date().toISOString(),
      });
      setIsStreaming(false);
      setCompanionStatus({ status: 'idle' });
      return;
    }

    // Prepare the streaming call (Henry charter + mode + memory + mode-specific options)
    const systemPrompt = buildCompanionStreamSystemPrompt(effectiveMode, memoryContext, {
      ...(effectiveMode === 'biblical' ? { biblicalSourceProfileId: biblicalSourceProfileId } : {}),
      ...(effectiveMode === 'writer'
        ? {
            writerDocumentTypeId: writerDocumentTypeId,
            writerActiveDraftRelativePath: writerActiveDraftPath,
          }
        : {}),
      ...(effectiveMode === 'design3d'
        ? {
            design3dWorkflowTypeId: design3dWorkflowTypeId,
            design3dReferencePath: design3dRefPath,
          }
        : {}),
    });

    const messagesPayload: HenryAIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({
        role: m.role as HenryAIMessage['role'],
        content: m.content,
      })),
    ];

    const apiKey = provider.api_key || provider.apiKey || '';

    // ── HTTPS + Ollama guard ────────────────────────────────────────────────
    // Browsers silently block HTTP requests from HTTPS pages (mixed content).
    // Catch this before the fetch so we can show a helpful message instead of
    // the cryptic "load failed" network error.
    if (companionProvider === 'ollama' && window.location.protocol === 'https:') {
      const ollamaBase = (useStore.getState().settings.ollama_base_url || 'http://localhost:11434');
      if (ollamaBase.startsWith('http://')) {
        addMessage({
          id: crypto.randomUUID(),
          conversation_id: convId,
          role: 'assistant',
          content: [
            `🔒 **Henry can't reach Ollama from this browser page**`,
            ``,
            `Ollama runs on plain HTTP (\`${ollamaBase}\`), but this page is HTTPS — the browser blocks that connection automatically.`,
            ``,
            `**Your options:**`,
            `- **Use the desktop app** — Henry connects to Ollama directly, no browser restrictions`,
            `- **Switch to a Cloud AI** — OpenAI, Anthropic, or Google. Add an API key in **Settings → AI Providers**`,
            `- **iPad → Mac IP** — If Ollama is on your Mac at e.g. \`192.168.x.x\`, update the URL in **Settings → AI Providers → Ollama** (must still be served over HTTPS or via the desktop app)`,
          ].join('\n'),
          engine: 'companion',
          created_at: new Date().toISOString(),
        });
        setStreamingContent('');
        setIsStreaming(false);
        setCompanionStatus({ status: 'idle' });
        return;
      }
    }

    try {
      setCompanionStatus({ status: 'streaming' });

      const stream = window.henryAPI.streamMessage({
        provider: companionProvider,
        model: companionModel,
        apiKey,
        messages: messagesPayload,
        temperature: 0.7,
      });

      streamRef.current = stream;

      stream.onChunk((chunk: string) => {
        if (import.meta.env.DEV && chunk) {
          console.debug('[Henry] stream chunk', { len: chunk.length });
        }
        appendStreamingContent(chunk);
      });

      stream.onDone(async (fullText: string, usage?: any) => {
        if (import.meta.env.DEV) {
          console.debug('[Henry] stream done', { fullLen: fullText?.length ?? 0, usage });
        }
        // Save assistant message
        const assistantMsg = {
          id: crypto.randomUUID(),
          conversation_id: convId,
          role: 'assistant' as const,
          content: fullText,
          engine: 'companion' as const,
          model: companionModel,
          provider: companionProvider,
          tokens_used: usage?.total_tokens,
          cost: usage?.cost,
          created_at: new Date().toISOString(),
        };

        addMessage(assistantMsg);
        setStreamingContent('');
        setIsStreaming(false);
        setCompanionStatus({ status: 'idle' });

        // Builder mode: extract HTML and show live preview
        if (effectiveMode === 'builder') {
          const extracted = extractHtmlFromMessage(fullText);
          if (extracted) {
            setBuilderPreviewHtml(extracted);
            setBuilderPreviewOpen(true);
          }
        }

        try {
          await window.henryAPI.saveMessage(assistantMsg);
        } catch (err) {
          console.error('Failed to save assistant message:', err);
        }

        // Try to extract and save any facts from the conversation
        try {
          if (content.length > 30) {
            await window.henryAPI.saveFact({
              conversation_id: convId,
              fact: content.slice(0, 200),
              category: 'conversation',
              importance: 1,
            });
          }
        } catch {
          // Fact extraction is optional
        }

        // Auto-name conversation after the first complete exchange
        try {
          const allConvMsgs = useStore.getState().messages.filter((m) => m.conversation_id === convId);
          const userCount = allConvMsgs.filter((m) => m.role === 'user').length;
          if (userCount === 1) {
            void autoNameConversation(convId, content, fullText, companionProvider, companionModel, apiKey);
          }
        } catch { /* optional */ }

        // Auto-delegate to Worker Brain if the task is heavy and Worker is configured
        const heavyTaskType = detectTaskType(content);
        const isHeavyTask = heavyTaskType === 'code_generate' || heavyTaskType === 'research';
        if (isHeavyTask) {
          const s = useStore.getState().settings;
          const workerProvider = s.worker_provider;
          const workerModel = s.worker_model;
          if (workerProvider && workerModel) {
            // Silent delegation — Companion already responded, Worker supplements with deep output
            void handleWorkerRequest(content, convId, true);
          }
        }
      });

      stream.onError(async (error: string) => {
        // Try fallback model before showing error
        const curSettings = useStore.getState().settings;
        const fallbackM = curSettings.companion_model_2;
        const fallbackP = curSettings.companion_provider_2 || curSettings.companion_provider;
        const usedFallback = companionModel !== curSettings.companion_model; // already on fallback

        if (fallbackM && fallbackP && !usedFallback && fallbackM !== companionModel) {
          setStreamingContent('');
          setCompanionStatus({ status: 'thinking' });
          // Swap to fallback and retry the exact same call
          const fallbackProviders = await window.henryAPI.getProviders();
          const fbProvider = fallbackProviders.find((p: any) => p.id === fallbackP);
          const fbApiKey = fbProvider?.api_key || fbProvider?.apiKey || '';

          const fbStream = window.henryAPI.streamMessage({
            provider: fallbackP,
            model: fallbackM,
            apiKey: fbApiKey,
            messages: messagesPayload,
            temperature: 0.7,
          });

          streamRef.current = fbStream;
          setCompanionStatus({ status: 'streaming' });

          fbStream.onChunk((chunk: string) => { appendStreamingContent(chunk); });
          fbStream.onDone(async (fullText: string) => {
            const fbMsg = {
              id: crypto.randomUUID(),
              conversation_id: convId,
              role: 'assistant' as const,
              content: fullText,
              engine: 'companion' as const,
              model: fallbackM,
              provider: fallbackP,
              created_at: new Date().toISOString(),
            };
            addMessage(fbMsg);
            setStreamingContent('');
            setIsStreaming(false);
            setCompanionStatus({ status: 'idle' });
            if (effectiveMode === 'builder') {
              const extracted = extractHtmlFromMessage(fullText);
              if (extracted) { setBuilderPreviewHtml(extracted); setBuilderPreviewOpen(true); }
            }
            try { await window.henryAPI.saveMessage(fbMsg); } catch { /* optional */ }
          });
          fbStream.onError((fbError: string) => {
            addMessage({
              id: crypto.randomUUID(),
              conversation_id: convId,
              role: 'assistant',
              content: `❌ Both models failed.\nPrimary (${companionModel}): ${error}\nFallback (${fallbackM}): ${fbError}`,
              engine: 'companion',
              created_at: new Date().toISOString(),
            });
            setStreamingContent('');
            setIsStreaming(false);
            setCompanionStatus({ status: 'error', message: fbError });
            setTimeout(() => setCompanionStatus({ status: 'idle' }), 3000);
          });
          return;
        }

        const isNetworkBlock = /load failed|failed to fetch|networkerror|network request failed/i.test(error);
        const isOllama = companionProvider === 'ollama';
        const isHttpsCtx = window.location.protocol === 'https:';

        let errorContent: string;
        if (isNetworkBlock && isOllama && isHttpsCtx) {
          errorContent = [
            `🔒 **Henry can't reach Ollama from this browser page**`,
            ``,
            `Ollama runs on HTTP but this page is HTTPS — the browser blocks that connection.`,
            ``,
            `**Fix:** Open **Settings → AI Providers** and switch to a Cloud AI (OpenAI / Anthropic / Google), or use the Henry desktop app where this restriction doesn't apply.`,
          ].join('\n');
        } else if (isNetworkBlock) {
          errorContent = `❌ **Connection failed** (\`${error}\`)\n\nHenry couldn't reach the AI provider. Check that your API key is correct in **Settings → AI Providers**, or try again in a moment.`;
        } else {
          errorContent = `❌ **Error:** ${error}`;
        }

        addMessage({
          id: crypto.randomUUID(),
          conversation_id: convId,
          role: 'assistant',
          content: errorContent,
          engine: 'companion',
          created_at: new Date().toISOString(),
        });
        setStreamingContent('');
        setIsStreaming(false);
        setCompanionStatus({ status: 'error', message: error });
        setTimeout(() => setCompanionStatus({ status: 'idle' }), 3000);
      });
    } catch (err: any) {
      addMessage({
        id: crypto.randomUUID(),
        conversation_id: convId,
        role: 'assistant',
        content: `❌ Failed to start stream: ${err.message}`,
        engine: 'companion',
        created_at: new Date().toISOString(),
      });
      setIsStreaming(false);
      setCompanionStatus({ status: 'idle' });
    }
  }

  async function handleWorkerRequest(content: string, convId: string, silent = false) {
    const taskType = detectTaskType(content);

    // Get recent conversation messages so Worker has the same context as Companion
    const threadMsgs = useStore.getState().messages.filter((m) => m.conversation_id === convId);
    const contextMessages: HenryAIMessage[] = threadMsgs
      .slice(-10)
      .map((m) => ({ role: m.role as HenryAIMessage['role'], content: m.content.slice(0, 800) }));

    if (!silent) {
      addMessage({
        id: crypto.randomUUID(),
        conversation_id: convId,
        role: 'assistant',
        content: `⚡ Worker Brain is on it...\n\n> ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}\n\nRunning in background — result will appear here when done.`,
        engine: 'worker',
        created_at: new Date().toISOString(),
      });
    }

    try {
      const result = await window.henryAPI.submitTask({
        description: content.slice(0, 200),
        type: taskType,
        payload: {
          prompt: content,
          conversationId: convId,
          context_messages: contextMessages,
          current_mode: operatingMode,
          auto_delegated: silent,
        },
        sourceEngine: 'companion',
        conversationId: convId,
        createdFromMode: operatingMode,
      });

      setWorkerStatus({
        status: 'working',
        taskId: result.id,
        taskDescription: content.slice(0, 100),
      });
    } catch (err: any) {
      if (!silent) {
        addMessage({
          id: crypto.randomUUID(),
          conversation_id: convId,
          role: 'assistant',
          content: `❌ Failed to start Worker: ${err.message}`,
          engine: 'worker',
          created_at: new Date().toISOString(),
        });
      }
    }
  }

  function detectTaskType(content: string): string {
    const lower = content.toLowerCase();
    if (lower.includes('code') || lower.includes('function') || lower.includes('implement') || lower.includes('build') || lower.includes('create a')) {
      return 'code_generate';
    }
    if (lower.includes('research') || lower.includes('find') || lower.includes('compare') || lower.includes('analyze')) {
      return 'research';
    }
    if (lower.includes('file') || lower.includes('read') || lower.includes('write') || lower.includes('save')) {
      return 'file_operation';
    }
    return 'ai_generate';
  }

  async function handleSearch(query: string) {
    if (isSearching || isStreaming) return;
    setIsSearching(true);
    logAction({ type: 'search', description: `Web search: ${query}`, input: query, success: true });
    try {
      const apiKeys = getSearchApiKeys();
      const sr = await webSearch(query, apiKeys);
      const formatted = formatSearchResultsForHenry(sr);
      const injected = `${formatted}\n\n---\nMy question: ${query}`;
      setChatInject({ id: Date.now(), text: injected });
    } catch (err) {
      console.error('[Henry] web search failed:', err);
      setChatInject({
        id: Date.now(),
        text: `Search failed for: ${query}\n\nMy question: ${query}`,
      });
    } finally {
      setIsSearching(false);
    }
  }

  async function handleBrowseUrl(url: string, userQuestion?: string) {
    if (isSearching || isStreaming) return;
    setIsSearching(true);
    logAction({ type: 'search', description: `Browse URL: ${url}`, input: url, success: true });
    try {
      const page = await fetchPageContent(url);
      const formatted = formatPageContentForHenry(page);
      const suffix = userQuestion ? `\n\n---\nMy question: ${userQuestion}` : '';
      setChatInject({ id: Date.now(), text: `${formatted}${suffix}` });
    } catch (err) {
      console.error('[Henry] URL browse failed:', err);
      setChatInject({ id: Date.now(), text: `Failed to browse ${url}. Error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setIsSearching(false);
    }
  }

  function cancelStream() {
    if (streamRef.current) {
      streamRef.current.cancel();
      streamRef.current = null;
    }
    setStreamingContent('');
    setIsStreaming(false);
    setCompanionStatus({ status: 'idle' });
  }

  // Keep wake word ref always pointing to latest handleSend (safe to assign during render)
  wakeHandleSendRef.current = handleSend;

  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
        {recoveryBannerOpen && recoverySnapshot && (
          <div className="max-w-3xl mx-auto mb-4 rounded-lg border border-henry-accent/25 bg-henry-surface/30 px-3 py-2.5 text-xs text-henry-text">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-henry-accent/90">
                  Recovered session
                </p>
                <p className="text-[10px] text-henry-text-muted mt-1 leading-relaxed">
                  Henry restores selected context and summary state, not full hidden replay.
                </p>
                <ul className="mt-2 space-y-0.5 text-[10px] text-henry-text-dim">
                  <li>
                    <span className="text-henry-text-muted">Thread:</span>{' '}
                    {recoveryConvMissing ? (
                      <span className="text-amber-400/90">Previous conversation no longer available</span>
                    ) : recoveryThreadTitle ? (
                      <span className="text-henry-text">{recoveryThreadTitle}</span>
                    ) : (
                      <span className="text-henry-text-dim">None selected last time</span>
                    )}
                    {recoveryConvRestored && (
                      <span className="text-henry-text-muted"> — messages loaded</span>
                    )}
                  </li>
                  <li>
                    <span className="text-henry-text-muted">Mode:</span> {resumeModeLabel(operatingMode)}
                  </li>
                  {operatingMode === 'biblical' && bibleProfileRecovery && (
                    <li>
                      <span className="text-henry-text-muted">Bible source:</span> {bibleProfileRecovery.label}
                    </li>
                  )}
                  {writerActiveDraftPath?.trim() && (
                    <li className="break-all">
                      <span className="text-henry-text-muted">Writer draft:</span>{' '}
                      {writerActiveDraftPath.trim()}
                      {recoveryStale?.writerDraftStale && (
                        <span className="text-amber-400/90"> — path not found in workspace</span>
                      )}
                    </li>
                  )}
                  {design3dRefPath?.trim() && (
                    <li className="break-all">
                      <span className="text-henry-text-muted">Design3D reference:</span>{' '}
                      {design3dRefPath.trim()}
                      {recoveryStale?.design3dRefStale && (
                        <span className="text-amber-400/90"> — path not found in workspace</span>
                      )}
                    </li>
                  )}
                  {activeWorkspaceContext && (
                    <li className="break-all">
                      <span className="text-henry-text-muted">Workspace context:</span>{' '}
                      {activeWorkspaceContext.label} ({activeWorkspaceContext.path})
                      {recoveryStale?.workspaceContextStale && (
                        <span className="text-amber-400/90"> — path not found in workspace</span>
                      )}
                    </li>
                  )}
                  {recoverySnapshot.lastExportPackRelativeDir && (
                    <li className="break-all">
                      <span className="text-henry-text-muted">Last export pack:</span>{' '}
                      {recoverySnapshot.lastExportPackRelativeDir}
                      {recoveryStale?.exportPackStale && (
                        <span className="text-amber-400/90"> — manifest missing (folder may have moved)</span>
                      )}
                    </li>
                  )}
                </ul>
              </div>
              <button
                type="button"
                onClick={handleRecoveryDismiss}
                className="shrink-0 text-[10px] text-henry-text-muted hover:text-henry-text"
                aria-label="Dismiss recovery notice"
              >
                ×
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2.5">
              {recoverySnapshot.lastConversationId &&
                conversations.some((c) => c.id === recoverySnapshot.lastConversationId) && (
                  <button
                    type="button"
                    disabled={isStreaming}
                    onClick={() => void handleResumeLastThread()}
                    className="px-2.5 py-1 rounded-md bg-henry-accent/85 text-white text-[10px] font-medium hover:bg-henry-accent disabled:opacity-40"
                  >
                    Resume last thread
                  </button>
                )}
              <button
                type="button"
                disabled={isStreaming}
                onClick={handleSessionStartClean}
                className="px-2.5 py-1 rounded-md border border-henry-border/50 text-[10px] text-henry-text-muted hover:text-henry-text disabled:opacity-40"
              >
                Start clean
              </button>
            </div>
          </div>
        )}
        {messages.length === 0 && !isStreaming ? (
          <EmptyChat
            onModeAndInject={(mode, text) => {
              setOperatingMode(mode);
              setChatInject({ id: Date.now(), text });
            }}
          />
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg) => {
              const head = msg.content.trimStart();
              const isErrorBubble =
                msg.role === 'assistant' && (head.startsWith('⚠️') || head.startsWith('❌'));
              const showWorkspaceSave =
                (operatingMode === 'writer' || operatingMode === 'design3d') &&
                msg.role === 'assistant' &&
                msg.engine !== 'worker' &&
                !isErrorBubble;
              const showCreateTask =
                shouldOfferCreateTaskFromMessage(operatingMode, msg, isErrorBubble) &&
                msg.engine !== 'worker';

              const isAuthError = isErrorBubble &&
                /unauthorized|401|invalid.api.key|api[\s_-]?key|no.*key|authentication|billing|quota|forbidden|403/i.test(msg.content);

              return (
                <div key={msg.id}>
                  <MessageBubble
                    message={msg}
                    workspaceSaveDraft={
                      showWorkspaceSave
                        ? {
                            enabled: true,
                            workspaceReady: !!settings.workspace_path?.trim(),
                            busy: saveWorkspaceDraftBusy,
                            label:
                              operatingMode === 'design3d' ? 'Save design plan' : 'Save draft',
                            onSave: () =>
                              operatingMode === 'design3d'
                                ? handleSaveDesign3dPlan(msg.content)
                                : handleSaveWriterDraft(msg.content),
                          }
                        : undefined
                    }
                    createTask={
                      showCreateTask
                        ? {
                            onClick: () => setCreateTaskFromMessage(msg),
                            disabled: isStreaming,
                          }
                        : undefined
                    }
                  />
                  {isAuthError && (
                    <div className="flex items-center gap-2 mt-1 ml-11 pb-1">
                      <button
                        onClick={() => useStore.getState().setCurrentView('settings')}
                        className="text-xs text-henry-accent hover:underline flex items-center gap-1"
                      >
                        → Add or fix your API key in Settings
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Streaming indicator — show as soon as streaming starts (content may be empty until first chunk) */}
            {isStreaming && (
              <MessageBubble
                message={{
                  id: 'streaming',
                  conversation_id: '',
                  role: 'assistant',
                  content: streamingContent,
                  engine: 'companion',
                  created_at: new Date().toISOString(),
                }}
                isStreaming={true}
                streamingContent={streamingContent}
              />
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-henry-border/30 bg-henry-surface/20 px-3 sm:px-6 py-3 sm:py-4">
        <div className="max-w-3xl mx-auto">
          {operatingMode === 'biblical' && (
            <ScriptureToolsPanel
              disabled={isStreaming}
              onInjectChat={(text) => setChatInject({ id: Date.now(), text })}
              onRequestExportPack={() => openExportPack('biblical_study_pack')}
            />
          )}
          {operatingMode === 'design3d' && (
            <Design3DReferencePanel
              referencePath={design3dRefPath}
              workflowTypeId={design3dWorkflowTypeId}
              onWorkflowChange={setDesign3dWorkflowTypeId}
              onInjectChat={(text) => setChatInject({ id: Date.now(), text })}
              disabled={isStreaming}
              onRequestExportPack={() => openExportPack('design3d_handoff')}
            />
          )}
          {operatingMode === 'writer' && (
            <WriterDraftLibrary
              writerDocumentTypeId={writerDocumentTypeId}
              activeDraftPath={writerActiveDraftPath}
              onInjectChat={(text) => setChatInject({ id: Date.now(), text })}
              disabled={isStreaming}
              onRequestExportPack={() => openExportPack('writer_handoff')}
            />
          )}
          {!!settings.workspace_path?.trim() && (
            <WorkspaceContextStrip
              context={activeWorkspaceContext}
              indexHintForCopy={workspaceContextIndexHint}
              onInjectChat={(text) => setChatInject({ id: Date.now(), text })}
              disabled={isStreaming}
            />
          )}
          {exportPackChatActionVisible && (
            <div className="flex justify-end mb-2">
              <button
                type="button"
                disabled={isStreaming}
                onClick={() => openExportPack(exportPresetForOperatingMode(operatingMode))}
                className="text-[10px] uppercase tracking-wide text-henry-accent/90 hover:text-henry-accent disabled:opacity-40"
              >
                Create export pack
              </button>
            </div>
          )}
          {isSearching && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-lg bg-henry-accent/8 border border-henry-accent/15 text-xs text-henry-accent/80 animate-fade-in">
              <svg className="w-3.5 h-3.5 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
              <span>Searching the web for current information…</span>
            </div>
          )}
          {autoSwitchNotice && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-lg bg-henry-accent/10 border border-henry-accent/20 text-xs text-henry-accent animate-fade-in">
              <span>✦</span>
              <span>Switched to <strong>{autoSwitchNotice}</strong> mode based on your message</span>
              <button
                onClick={() => setAutoSwitchNotice(null)}
                className="ml-auto text-henry-accent/60 hover:text-henry-accent"
              >
                ×
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 md:gap-3 overflow-x-auto scrollbar-none pb-0.5">
            <EngineSelector
              selectedEngine={selectedEngine}
              onSelect={setSelectedEngine}
            />
            <label className="flex flex-col gap-1 shrink-0 text-[10px] text-henry-text-muted uppercase tracking-wide">
              Mode
              <select
                className="text-xs font-medium normal-case tracking-normal rounded-lg border border-henry-border/40 bg-henry-surface/40 text-henry-text px-2 py-1.5 min-w-[8.5rem] focus:outline-none focus:ring-1 focus:ring-henry-accent/50"
                value={operatingMode}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isHenryOperatingMode(v)) setOperatingMode(v);
                }}
                aria-label="Henry operating mode"
              >
                {HENRY_OPERATING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_HUMAN_LABELS[m] ?? m}
                  </option>
                ))}
              </select>
            </label>
            {operatingMode === 'design3d' && (
              <label className="flex flex-col gap-1 shrink-0 text-[10px] text-henry-text-muted uppercase tracking-wide">
                Workflow
                <select
                  className="text-xs font-medium normal-case tracking-normal rounded-lg border border-henry-border/40 bg-henry-surface/40 text-henry-text px-2 py-1.5 max-w-[10.5rem] focus:outline-none focus:ring-1 focus:ring-henry-accent/50"
                  value={design3dWorkflowTypeId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (isDesign3DWorkflowTypeId(v)) setDesign3dWorkflowTypeId(v);
                  }}
                  aria-label="Design3D workflow type"
                >
                  {DESIGN3D_WORKFLOW_TYPES.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {operatingMode === 'writer' && (
              <label className="flex flex-col gap-1 shrink-0 text-[10px] text-henry-text-muted uppercase tracking-wide">
                Doc type
                <select
                  className="text-xs font-medium normal-case tracking-normal rounded-lg border border-henry-border/40 bg-henry-surface/40 text-henry-text px-2 py-1.5 max-w-[10rem] focus:outline-none focus:ring-1 focus:ring-henry-accent/50"
                  value={writerDocumentTypeId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (isWriterDocumentTypeId(v)) setWriterDocumentTypeId(v);
                  }}
                  aria-label="Writer document type"
                >
                  {WRITER_DOCUMENT_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {operatingMode === 'biblical' && (
              <label className="flex flex-col gap-1 shrink-0 text-[10px] text-henry-text-muted uppercase tracking-wide">
                Bible source
                <select
                  className="text-xs font-medium normal-case tracking-normal rounded-lg border border-henry-border/40 bg-henry-surface/40 text-henry-text px-2 py-1.5 max-w-[11rem] focus:outline-none focus:ring-1 focus:ring-henry-accent/50"
                  value={biblicalSourceProfileId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (isBibleSourceProfileId(v)) setBiblicalSourceProfileId(v);
                  }}
                  aria-label="Bible source profile for Biblical mode"
                >
                  {BIBLE_SOURCE_PROFILES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex-1">
              <ChatInput
                onSend={handleSend}
                isStreaming={isStreaming}
                onCancel={isStreaming ? cancelStream : undefined}
                injectDraft={chatInject}
                onInjectConsumed={() => setChatInject(null)}
                placeholder="Message Henry…"
                ttsEnabled={ttsEnabled}
                onToggleTts={toggleTts}
                onSearch={handleSearch}
                isSearching={isSearching}
              />
            </div>
          </div>
          {operatingMode === 'biblical' && (
            <p className="text-[10px] text-henry-text-muted mt-2 leading-relaxed">
              Local scripture lookup is available for imported references; missing references are labeled
              honestly. Scripture-first mode: scripture, commentary, interpretation, and speculation are
              labeled distinctly. First line e.g.{' '}
              <span className="text-henry-text-dim">John 3:16</span> or{' '}
              <span className="text-henry-text-dim">Read Psalm 23:1</span>. Sample import:{' '}
              <code className="text-henry-text-dim">src/henry/sampleScripture.json</code>.
            </p>
          )}
          {operatingMode === 'writer' && (
            <p className="text-[10px] text-henry-text-muted mt-2 leading-relaxed">
              Writer mode: structured markdown you can save. Use &quot;Save draft&quot; on assistant replies
              (metadata is added on save). Pick a prior draft with <span className="text-henry-text-dim">Use as context</span> for lean continuity — Henry does not auto-load file contents.
            </p>
          )}
          {operatingMode === 'builder' && (
            <p className="text-[10px] text-henry-text-muted mt-2 leading-relaxed">
              App Builder: describe anything — landing page, dashboard, tool, game. Henry generates a complete,
              working HTML app instantly. Preview appears live on the right. Tell him to change anything and he
              rebuilds it in full.
              {builderPreviewHtml && !builderPreviewOpen && (
                <button
                  onClick={() => setBuilderPreviewOpen(true)}
                  className="ml-1 text-henry-accent hover:underline"
                >
                  Show preview →
                </button>
              )}
            </p>
          )}
          {operatingMode === 'design3d' && (
            <p className="text-[10px] text-henry-text-muted mt-2 leading-relaxed">
              Design3D mode: label measured vs estimated dimensions clearly. In Files, use{' '}
              <span className="text-henry-text-dim">Ref</span> on a file to set the active reference (path only
              — not file contents). Reference files guide the plan; exact dimensions still require direct
              measurement. Use &quot;Save design plan&quot; for markdown under{' '}
              <code className="text-henry-text-dim">Henry-Design3D/</code> (metadata is added automatically).
            </p>
          )}
        </div>
      </div>
      </div>
      {(operatingMode === 'builder' || builderPreviewOpen) && (
        <BuilderPreviewPanel
          html={builderPreviewHtml}
          isStreaming={isStreaming}
          streamingHtml={streamingContent}
          onClose={() => setBuilderPreviewOpen(false)}
        />
      )}

      <MemoryAwarenessPanel
        operatingMode={operatingMode}
        biblicalSourceProfileId={biblicalSourceProfileId}
        writerDocumentTypeId={writerDocumentTypeId}
        design3dWorkflowTypeId={design3dWorkflowTypeId}
        design3dReferencePath={design3dRefPath}
        writerActiveDraftPath={writerActiveDraftPath}
        activeWorkspaceContext={activeWorkspaceContext}
        sessionContextRestored={memoryPanelSessionHint}
        disabled={isStreaming}
      />

      <ExportPackBuilder
        key={exportPackSession}
        open={exportPackOpen}
        initialPreset={exportPackPreset}
        workspaceReady={!!settings.workspace_path?.trim()}
        context={{
          operatingMode,
          writerActiveDraftPath,
          design3dRefPath,
          activeWorkspaceContext,
          activeConversationId,
          tasks,
        }}
        onClose={() => setExportPackOpen(false)}
        onExportCreated={(baseDir) => {
          const st = useStore.getState();
          saveSessionResumeSnapshot({
            lastConversationId: st.activeConversationId,
            operatingMode,
            biblicalSourceProfileId,
            writerDocumentTypeId,
            design3dWorkflowTypeId,
            writerActiveDraftPath,
            design3dReferencePath: design3dRefPath,
            activeWorkspaceContext,
            lastExportPackRelativeDir: baseDir,
          });
          setRecoverySnapshot((prev) =>
            prev
              ? { ...prev, lastExportPackRelativeDir: baseDir, savedAt: new Date().toISOString() }
              : readSavedSessionResume()
          );
        }}
      />

      <CreateTaskFromMessageModal
        open={!!createTaskFromMessage}
        suggestion={
          createTaskFromMessage
            ? buildSuggestedTaskFromMessage({
                message: createTaskFromMessage,
                operatingMode,
                linkage: resolveWorkspaceLinkageForTask(operatingMode, {
                  writerActiveDraftPath,
                  design3dRefPath,
                }),
              })
            : null
        }
        onClose={() => setCreateTaskFromMessage(null)}
        onSubmit={async (title, body) => {
          const msg = createTaskFromMessage;
          if (!msg) return;
          const sug = buildSuggestedTaskFromMessage({
            message: msg,
            operatingMode,
            linkage: resolveWorkspaceLinkageForTask(operatingMode, {
              writerActiveDraftPath,
              design3dRefPath,
            }),
          });
          const result = await window.henryAPI.submitTask({
            description: title,
            type: sug.taskType,
            priority: 6,
            sourceEngine: 'companion',
            conversationId: msg.conversation_id,
            payload: {
              prompt: body,
              henryOrigin: {
                createdFromMode: sug.sourceMode,
                relatedFilePath: sug.relatedFilePath,
                createdFromMessageId: sug.createdFromMessageId,
                relatedConversationId: sug.relatedConversationId,
              },
            },
            createdFromMode: sug.sourceMode,
            relatedFilePath: sug.relatedFilePath,
            createdFromMessageId: sug.createdFromMessageId,
          });
          const st = useStore.getState();
          if (!st.tasks.some((t) => t.id === result.id)) {
            const now = new Date().toISOString();
            st.addTask({
              id: result.id,
              description: title,
              type: sug.taskType,
              status: 'queued',
              priority: 6,
              created_at: now,
              created_from_mode: sug.sourceMode,
              related_file_path: sug.relatedFilePath,
              created_from_message_id: sug.createdFromMessageId,
              source_engine: 'companion',
              conversation_id: msg.conversation_id,
            });
          }
          setWorkerStatus({
            status: 'working',
            taskId: result.id,
            taskDescription: title.slice(0, 100),
          });
        }}
      />
    </div>
  );
}

const DISCOVERY_MODES: Array<{
  mode: HenryOperatingMode;
  icon: string;
  title: string;
  desc: string;
  examples: string[];
}> = [
  {
    mode: 'companion',
    icon: '💬',
    title: 'Just Talk',
    desc: 'Ask anything, think out loud, plan your day, or have a real conversation.',
    examples: [
      'What should I focus on today?',
      'Help me think through a decision I\'m facing',
      'Give me a motivating thought for the morning',
    ],
  },
  {
    mode: 'writer',
    icon: '✍️',
    title: 'Write Something',
    desc: 'Letters, essays, stories, outlines, summaries — you describe it, Henry drafts it.',
    examples: [
      'Help me write an email to my landlord',
      'Draft a short essay about gratitude',
      'Give me an outline for a 5-page report',
    ],
  },
  {
    mode: 'biblical',
    icon: '📖',
    title: 'Bible Study',
    desc: 'Explore scripture, theology, and history. Ethiopian Orthodox tradition aware.',
    examples: [
      'Explain the meaning of John 3:16',
      'What does the Ethiopian Orthodox Church teach about fasting?',
      'Walk me through Psalm 23 verse by verse',
    ],
  },
  {
    mode: 'builder',
    icon: '🌐',
    title: 'Build an App',
    desc: 'Describe a website or app. Henry generates it live — one HTML file, works instantly.',
    examples: [
      'Build me a personal landing page',
      'Create a task manager app with localStorage',
      'Make a dashboard with charts and stats',
    ],
  },
  {
    mode: 'developer',
    icon: '💻',
    title: 'Help With Code',
    desc: 'Debug errors, explain concepts, review code, or plan a project.',
    examples: [
      'Why does my code keep giving an error?',
      'Explain what a for loop does in plain English',
      'Review this function and suggest improvements',
    ],
  },
  {
    mode: 'design3d',
    icon: '🎨',
    title: 'Design & 3D',
    desc: 'Plan room layouts, 3D models, architectural ideas, and visual projects.',
    examples: [
      'Help me plan a small kitchen layout',
      'What are the steps to model a chair in Blender?',
      'Describe a cozy home office setup for me',
    ],
  },
];

function EmptyChat({
  onModeAndInject,
}: {
  onModeAndInject: (mode: HenryOperatingMode, text: string) => void;
}) {
  return (
    <div className="h-full flex items-start justify-center pt-8 pb-6 overflow-y-auto">
      <div className="w-full max-w-2xl px-4 animate-fade-in">
        <div className="text-center mb-7">
          <div className="text-5xl mb-3">🧠</div>
          <h2 className="text-xl font-bold text-henry-text mb-1">Henry AI</h2>
          <p className="text-sm text-henry-text-dim">
            What would you like to do? Click any example below to get started, or just type anything.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {DISCOVERY_MODES.map(({ mode, icon, title, desc, examples }) => (
            <div
              key={mode}
              className="p-4 rounded-xl bg-henry-surface/30 border border-henry-border/20 hover:border-henry-accent/20 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base">{icon}</span>
                <span className="font-semibold text-henry-text text-sm">{title}</span>
              </div>
              <p className="text-[11px] text-henry-text-muted mb-3 leading-relaxed">{desc}</p>
              <div className="space-y-1.5">
                {examples.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => onModeAndInject(mode, ex)}
                    className="w-full text-left text-[11px] px-2.5 py-1.5 rounded-lg bg-henry-surface/50 border border-henry-border/10 text-henry-text-dim hover:text-henry-text hover:border-henry-accent/30 hover:bg-henry-hover/30 transition-all"
                  >
                    "{ex}"
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-[10px] text-henry-text-muted mt-5">
          <span className="text-henry-text">Local</span> = free &amp; private (Ollama on your machine)
          {' · '}
          <span className="text-henry-text">Cloud</span> = more power (GPT-4, Claude, Gemini)
          {' · '}
          Change mode anytime using the dropdown below
        </p>
      </div>
    </div>
  );
}
