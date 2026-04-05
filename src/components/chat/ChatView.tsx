import { useRef, useEffect } from 'react';
import { useStore } from '../../store';
import ChatInput from './ChatInput';
import EngineSelector from './EngineSelector';
import MessageBubble from './MessageBubble';

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
  } = useStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<any>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  async function handleSend(content: string, engine: 'companion' | 'worker') {
    if (!content.trim() || isStreaming) return;

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
      // Companion uses streaming directly
      await handleCompanionStream(content, convId);
    }
  }

  async function handleCompanionStream(content: string, convId: string) {
    setIsStreaming(true);
    setStreamingContent('');
    setCompanionStatus({ status: 'thinking' });

    // Build context from memory
    let memoryContext = '';
    try {
      const ctx = await window.henryAPI.buildContext({
        conversationId: convId,
        query: content,
      });
      memoryContext = ctx.context;
    } catch {
      // Memory context is optional
    }

    // Build message history for API call
    const history = messages
      .filter((m) => m.conversation_id === convId)
      .slice(-20) // Last 20 messages for context
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    // Get companion engine settings
    const providers = await window.henryAPI.getProviders();
    const companionProvider = useStore.getState().settings.companion_provider;
    const companionModel = useStore.getState().settings.companion_model;
    const provider = providers.find((p: any) => p.id === companionProvider);

    if (!provider || !companionModel) {
      addMessage({
        id: crypto.randomUUID(),
        conversation_id: convId,
        role: 'assistant',
        content: '⚠️ Companion engine not configured. Please set up your AI provider in Settings.',
        engine: 'companion',
        created_at: new Date().toISOString(),
      });
      setIsStreaming(false);
      setCompanionStatus({ status: 'idle' });
      return;
    }

    // Prepare the streaming call
    const systemPrompt = `You are Henry AI — a calm, capable, focused AI assistant. You are the Companion engine: always available, conversational, and helpful. You handle everyday tasks, answer questions, and manage the user's workflow.

${memoryContext ? `Here's what you know:\n${memoryContext}\n` : ''}
When the user needs heavy work (code generation, long research, file operations), suggest delegating to the Worker engine.

Be concise but thorough. Use markdown for formatting. Be direct, not flowery.`;

    const messagesPayload = [
      { role: 'system', content: systemPrompt },
      ...history,
    ];

    try {
      setCompanionStatus({ status: 'streaming' });

      const stream = window.henryAPI.streamMessage({
        provider: companionProvider,
        model: companionModel,
        apiKey: provider.api_key,
        messages: messagesPayload,
        temperature: 0.7,
      });

      streamRef.current = stream;

      stream.onChunk((chunk: string) => {
        appendStreamingContent(chunk);
      });

      stream.onDone(async (fullText: string, usage?: any) => {
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

        try {
          await window.henryAPI.saveMessage(assistantMsg);
        } catch (err) {
          console.error('Failed to save assistant message:', err);
        }

        // Try to extract and save any facts from the conversation
        try {
          // Simple fact extraction — save key user preferences mentioned
          if (content.length > 30) {
            await window.henryAPI.saveFact({
              conversationId: convId,
              fact: content.slice(0, 200),
              category: 'conversation',
              importance: 1,
            });
          }
        } catch {
          // Fact extraction is optional
        }
      });

      stream.onError((error: string) => {
        addMessage({
          id: crypto.randomUUID(),
          conversation_id: convId,
          role: 'assistant',
          content: `❌ Error: ${error}`,
          engine: 'companion',
          created_at: new Date().toISOString(),
        });
        setStreamingContent('');
        setIsStreaming(false);
        setCompanionStatus({ status: 'error', message: error });

        // Reset to idle after 3 seconds
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

  async function handleWorkerRequest(content: string, convId: string) {
    // Determine task type from content
    const taskType = detectTaskType(content);

    // Add a "queued" indicator message
    addMessage({
      id: crypto.randomUUID(),
      conversation_id: convId,
      role: 'assistant',
      content: `⚡ Queuing task for Worker engine...\n\n> ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}\n\nType: \`${taskType}\` — Check the Tasks tab for progress.`,
      engine: 'worker',
      created_at: new Date().toISOString(),
    });

    // Submit to task queue
    try {
      const result = await window.henryAPI.submitTask({
        description: content.slice(0, 200),
        type: taskType,
        payload: JSON.stringify({
          prompt: content,
          conversationId: convId,
        }),
        sourceEngine: 'companion',
        conversationId: convId,
      });

      setWorkerStatus({
        status: 'working',
        taskId: result.id,
        taskDescription: content.slice(0, 100),
      });
    } catch (err: any) {
      addMessage({
        id: crypto.randomUUID(),
        conversation_id: convId,
        role: 'assistant',
        content: `❌ Failed to queue task: ${err.message}`,
        engine: 'worker',
        created_at: new Date().toISOString(),
      });
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

  function cancelStream() {
    if (streamRef.current) {
      streamRef.current.cancel();
      streamRef.current = null;
    }
    setStreamingContent('');
    setIsStreaming(false);
    setCompanionStatus({ status: 'idle' });
  }

  return (
    <div className="h-full flex flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && !isStreaming ? (
          <EmptyChat />
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {/* Streaming indicator */}
            {isStreaming && streamingContent && (
              <MessageBubble
                message={{
                  id: 'streaming',
                  conversation_id: '',
                  role: 'assistant',
                  content: streamingContent,
                  engine: 'companion',
                  created_at: new Date().toISOString(),
                  isStreaming: true,
                }}
              />
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-henry-border/30 bg-henry-surface/20 px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-3">
            <EngineSelector />
            <div className="flex-1">
              <ChatInput
                onSend={handleSend}
                disabled={isStreaming}
                onCancel={isStreaming ? cancelStream : undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md animate-fade-in">
        <div className="text-6xl mb-6">🧠</div>
        <h2 className="text-2xl font-bold text-henry-text mb-3">
          Henry AI
        </h2>
        <p className="text-henry-text-dim mb-6 leading-relaxed">
          Your personal AI operating system. Switch between
          <span className="text-henry-companion font-medium"> Companion </span>
          for quick chat and
          <span className="text-henry-worker font-medium"> Worker </span>
          for heavy tasks.
        </p>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <SuggestionCard
            icon="🧠"
            label="Companion"
            text="What should I work on today?"
          />
          <SuggestionCard
            icon="⚡"
            label="Worker"
            text="Generate a REST API for my app"
          />
          <SuggestionCard
            icon="🧠"
            label="Companion"
            text="Summarize my meeting notes"
          />
          <SuggestionCard
            icon="⚡"
            label="Worker"
            text="Research the best tech stack for a SaaS"
          />
        </div>
      </div>
    </div>
  );
}

function SuggestionCard({
  icon,
  label,
  text,
}: {
  icon: string;
  label: string;
  text: string;
}) {
  return (
    <button className="text-left p-3 rounded-xl bg-henry-surface/30 border border-henry-border/20 hover:border-henry-border/40 transition-all group">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs">{icon}</span>
        <span className="text-[10px] text-henry-text-muted">{label}</span>
      </div>
      <span className="text-henry-text-dim group-hover:text-henry-text transition-colors">
        {text}
      </span>
    </button>
  );
}
