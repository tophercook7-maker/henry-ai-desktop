import TitleBar from './TitleBar';
import Sidebar from './Sidebar';
import ChatView from '../chat/ChatView';
import TaskQueueView from '../queue/TaskQueueView';
import SettingsView from '../settings/SettingsView';
import FileBrowser from '../files/FileBrowser';
import WorkspaceView from '../workspace/WorkspaceView';
import { useStore } from '../../store';

export default function Layout() {
  const currentView = useStore((s) => s.currentView);

  return (
    <div className="h-screen w-screen flex flex-col bg-henry-bg overflow-hidden">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          {currentView === 'chat' && <ChatView />}
          {currentView === 'tasks' && <TaskQueueView />}
          {currentView === 'files' && <FileBrowser />}
          {currentView === 'workspace' && <WorkspaceView />}
          {currentView === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
}
