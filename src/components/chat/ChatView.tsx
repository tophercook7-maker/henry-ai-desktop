import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import EngineSelector from './EngineSelector';
import type { Message } from '../../types';
import { getModel, estimateCost } from '../../providers/models';

export default function ChatView() {
  const {
    activeConversationId,
    messages,
    providers,
    settings,
    isStreaming,
    streamingContent,
    addMessage,
    setMessages,
    setIsStreaming,
    setStreamingContent,
    appendStreamingContent,
    setActiveConversation,
    setConversations,
    updateMessage,
    setCompanionStatus,
  } = useStore();

  const [selectedEngine, setSelectedEngine] = useState<'companion' | 'worker'>('companion');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamCancelRef = useRef<(() => void) | null>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Get the active provider/model for selected engine
  function getEngineConfig() {
    const providerKey = selectedEngine === 'companion' ? 'companion_provider' : 'worker_provider';
    const modelKey = selectedEngine === 'companion' ? 'companion_model' : 'worker_model';
    const providerId = settings[providerKey];
    const modelId = settings[modelKey];
    const provider = providers.find((p) => p.id === providerId);
    return { providerId, modelId, apiKey: provider?.apiKey || '' };
  }

  async function handleSend(content: string) {
    if (isStreaming) return;

    const config = getEngineConfig();
    if (!config.providerId || !config.modelId || !config.apiKey) {
      // Show error or redirect to settings
      return;
    }

    // Create conversation if needed
    let convoId = activeConversationId;
    if (!convoId) {
      try {
        const convo = await window.henryAPI.createConversation(
          content.slice(0, 50) + (content.length > 50 ? '...' : '')
        );
        convoId = convo.id;
        setActiveConversation(convoId);
        const convos = await window.henryAPI.getConversations();
        setConversations(convos);
      } catch (err) {
        console.error('Failed to create conversation:', err);
        return;
      }
    }

    // Add user message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: convoId,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    addMessage(userMsg);

    // Save user message
    try {
      await window.henryAPI.saveMessage({
        id: userMsg.id,
        conversationId: convoId,
        role: 'user',
        content,
      });
    } catch (err) {
      console.error('Failed to save message:', err);
    }

    // Prepare assistant message placeholder
    const assistantMsgId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantMsgId,
      conversation_id: convoId,
      role: 'assistant',
      content: '',
      model: config.modelId,
      provider: config.providerId,
      engine: selectedEngine,
      created_at: new Date().toISOString(),
      isStreaming: true,
    };
    addMessage(assistantMsg);

    // Build message history for API
    const apiMessages = [
      {
        role: 'system',
        content: getSystemPrompt(selectedEngine),
      },
      ...messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content },
    ];

    // Start streaming
    setIsStreaming(true);
    setStreamingContent('');
    setCompanionStatus({ status: 'thinking' });

    try {
      const stream = window.henryAPI.streamMessage({
        provider: config.providerId,
        model: config.modelId,
        apiKey: config.apiKey,
        messages: apiMessages,
        temperature: parseFloat(settings.default_temperature) || 0.7,
      });

      streamCancelRef.current = stream.cancel;

      stream.onChunk((chunk: string) => {
        appendStreamingContent(chunk);
      });

      stream.onDone(async (fullText: string, usage?: any) => {
        // Calculate cost
        const cost = usage
          ? estimateCost(config.modelId, usage.input || 0, usage.output || 0)
          : 0;

        // Update message in state
        updateMessage(assistantMsgId, {
          content: fullText,
          tokens_used: usage ? (usage.input || 0) + (usage.output || 0) : 0,
          cost,
          isStreaming: false,
        });

        // Save to database
        try {
          await window.henryAPI.saveMessage({
            id: assistantMsgId,
            conversationId: convoId!,
            role: 'assistant',
            content: fullText,
            model: config.modelId,
            provider: config.providerId,
            tokensUsed: usage ? (usage.input || 0) + (usage.output || 0) : 0,
            cost,
            engine: selectedEngine,
          });
        } catch (err) {
          console.error('Failed to save assistant message:', err);
        }

        setIsStreaming(false);
        setStreamingContent('');
        setCompanionStatus({ status: 'idle' });
        streamCancelRef.current = null;
      });

      stream.onError((error: string) => {
        updateMessage(assistantMsgId, {
          content: `⚠️ Error: ${error}`,
          isStreaming: false,
        });
        setIsStreaming(false);
        setStreamingContent('');
        setCompanionStatus({ status: 'error' });
        streamCancelRef.current = null;
      });
    } catch (err: any) {
      updateMessage(assistantMsgId, {
        content: `⚠️ Error: ${err.message}`,
        isStreaming: false,
      });
      setIsStreaming(false);
      setStreamingContent('');
      setCompanionStatus({ status: 'error' });
    }
  }

  function handleCancel() {
    streamCancelRef.current?.();
    setIsStreaming(false);
    setStreamingContent('');
    setCompanionStatus({ status: 'idle' });
  }

  const config = getEngineConfig();
  const hasConfig = config.providerId && config.modelId && config.apiKey;

  return (
    <div className="h-full flex flex-col">
      {/* Engine selector bar */}
      <EngineSelector
        selectedEngine={selectedEngine}
        onSelect={setSelectedEngine}
      />

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && !activeConversationId ? (
          <EmptyState onNewChat={() => {}} />
        ) : (
          <div className="max-w-3xl mx-auto space-y-1">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={msg.isStreaming}
                streamingContent={
                  msg.isStreaming ? streamingContent : undefined
                }
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-henry-border/50 bg-henry-surface/30">
        <div className="max-w-3xl mx-auto p-4">
          {!hasConfig ? (
            <div className="text-center py-3">
              <p className="text-henry-text-dim text-sm">
                Configure your AI provider in{' '}
                <button
                  onClick={() => useStore.getState().setCurrentView('settings')}
                  className="text-henry-accent hover:text-henry-accent-hover underline"
                >
                  Settings
                </button>{' '}
                to start chatting.
              </p>
            </div>
          ) : (
            <ChatInput
              onSend={handleSend}
              onCancel={handleCancel}
              isStreaming={isStreaming}
              placeholder={
                selectedEngine === 'companion'
                  ? 'Chat with Henry...'
                  : 'Describe a task for the Worker...'
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="h-full flex items-center justify-center animate-fade-in">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-6">🧠</div>
        <h2 className="text-2xl font-semibold text-henry-text mb-3">
          Hey. I'm Henry.
        </h2>
        <p className="text-henry-text-dim mb-6 leading-relaxed">
          Your local AI operating system. I run on your machine, your data stays
          with you. Ask me anything or give me a task.
        </p>
        <div className="grid grid-cols-2 gap-3 text-left">
          {[
            { icon: '💬', label: 'Chat', desc: 'Ask anything, get instant answers' },
            { icon: '⚡', label: 'Execute', desc: 'Run tasks in the background' },
            { icon: '📁', label: 'Organize', desc: 'Manage your workspace & files' },
            { icon: '🔒', label: 'Private', desc: 'Everything stays on your machine' },
          ].map((item) => (
            <div
              key={item.label}
              className="p-3 rounded-lg bg-henry-surface/50 border border-henry-border/30"
            >
              <div className="text-lg mb-1">{item.icon}</div>
              <div className="text-sm font-medium text-henry-text">
                {item.label}
              </div>
              <div className="text-xs text-henry-text-muted">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function getSystemPrompt(engine: 'companion' | 'worker'): string {
  if (engine === 'companion') {
    return `You are Henry, a calm, capable, and focused AI assistant. You are the Companion engine — always available, quick to respond, and conversational.

Your personality:
- Professional but approachable. Like a trusted business partner.
- Direct and clear. No fluff, no corporate speak.
- You acknowledge what you don't know rather than guessing.
- You're proactive — suggest next steps, anticipate needs.

You help with:
- Quick questions and conversation
- Planning and brainstorming
- Checking on background task status
- Organizing and prioritizing work
- Summarizing and explaining

Keep responses focused and useful. Format with markdown when helpful.`;
  }

  return `You are Henry, operating as the Worker engine. You handle complex, resource-intensive tasks with thorough, detailed output.

Your approach:
- Methodical and comprehensive
- Include full code blocks with proper formatting
- Explain your reasoning step by step
- Produce production-quality output
- Handle multi-step tasks end to end

You excel at:
- Writing and debugging code
- Creating documents and reports
- Research and deep analysis
- File operations and organization
- Complex multi-step workflows

Produce the highest quality output. Take your time to be thorough.`;
}
