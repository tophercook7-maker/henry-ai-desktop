import { useEffect } from 'react';
import { useStore } from '../../store';
import type { Task } from '../../types';

export default function TaskQueueView() {
  const { tasks, setTasks } = useStore();

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    try {
      const tasks = await window.henryAPI.getTasks();
      setTasks(tasks);
    } catch (err) {
      console.error('Failed to load tasks:', err);
    }
  }

  const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'queued');
  const running = tasks.filter((t) => t.status === 'running');
  const completed = tasks.filter((t) => t.status === 'completed' || t.status === 'failed');

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50">
        <h1 className="text-lg font-semibold text-henry-text">Task Queue</h1>
        <p className="text-xs text-henry-text-dim mt-1">
          Background tasks handled by the Worker engine
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tasks.length === 0 ? (
          <EmptyQueue />
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {running.length > 0 && (
              <TaskSection title="Running" tasks={running} color="warning" />
            )}
            {pending.length > 0 && (
              <TaskSection title="Queued" tasks={pending} color="accent" />
            )}
            {completed.length > 0 && (
              <TaskSection
                title="Completed"
                tasks={completed.slice(0, 20)}
                color="text-dim"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskSection({
  title,
  tasks,
  color,
}: {
  title: string;
  tasks: Task[];
  color: string;
}) {
  return (
    <div>
      <h2 className="text-xs font-medium text-henry-text-muted uppercase tracking-wider mb-3">
        {title} ({tasks.length})
      </h2>
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  const statusColors: Record<string, string> = {
    pending: 'bg-henry-text-muted/20 text-henry-text-muted',
    queued: 'bg-henry-accent/20 text-henry-accent',
    running: 'bg-henry-warning/20 text-henry-warning',
    completed: 'bg-henry-success/20 text-henry-success',
    failed: 'bg-henry-error/20 text-henry-error',
    cancelled: 'bg-henry-text-muted/20 text-henry-text-muted',
  };

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-henry-surface/50 border border-henry-border/30">
      {/* Status */}
      <div
        className={`shrink-0 px-2 py-1 rounded-full text-[10px] font-medium ${
          statusColors[task.status] || ''
        }`}
      >
        {task.status}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-henry-text truncate">
          {task.description}
        </div>
        <div className="text-[10px] text-henry-text-muted mt-0.5">
          {task.type} · Priority {task.priority}
          {task.started_at &&
            ` · Started ${new Date(task.started_at).toLocaleTimeString()}`}
        </div>
      </div>

      {/* Running indicator */}
      {task.status === 'running' && (
        <div className="flex gap-1">
          <div className="typing-dot" />
          <div className="typing-dot" />
          <div className="typing-dot" />
        </div>
      )}
    </div>
  );
}

function EmptyQueue() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4">📋</div>
        <h2 className="text-lg font-semibold text-henry-text mb-2">
          No tasks in queue
        </h2>
        <p className="text-sm text-henry-text-dim max-w-sm">
          When you give Henry complex tasks using the Worker engine, they'll
          appear here with real-time status updates.
        </p>
      </div>
    </div>
  );
}
