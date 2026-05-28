/**
 * SettingsView — Settings tab content
 *
 * Placeholder restored on 2026-05-27 after the original file went missing
 * during iCloud-related file churn. Composes the existing settings panels
 * so the Settings tab boots; expand as needed.
 */

import RemoteControlPanel from './RemoteControlPanel';
import DeviceLinkPanel from './DeviceLinkPanel';
import HealthPanel from './HealthPanel';

export default function SettingsView() {
  return (
    <div className="h-full overflow-y-auto bg-henry-bg">
      <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-henry-text">Settings</h1>
          <p className="text-xs text-henry-text-muted mt-1">
            Pairing, device links, and system health.
          </p>
        </div>

        <section>
          <RemoteControlPanel />
        </section>

        <section>
          <DeviceLinkPanel />
        </section>

        <section>
          <HealthPanel />
        </section>
      </div>
    </div>
  );
}
