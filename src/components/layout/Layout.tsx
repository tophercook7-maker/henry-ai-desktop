import { useStore } from '../../store';
import Sidebar from './Sidebar';
import TitleBar from './TitleBar';
import ChatView from '../chat/ChatView';
import TaskQueueView from '../queue/TaskQueueView';
import SettingsView from '../settings/SettingsView';

export default function Layout() {
  const { currentView } = useStore();

  return (
    <div className="h-screen w-screen flex flex-col bg-henry-bg overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          {currentView === 'chat' && <ChatView />}
          {currentView === 'tasks' && <TaskQueueView />}
          {currentView === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
}
