import type { SettingsPage } from './types';
import { parentSettingsPage } from './navigation';

// Reader phases share an observation ID. Closing settings preserves its route.
export class SettingsNavigationMemory {
  scope: string | null = null;
  page: SettingsPage = 'index';
  private history: SettingsPage[] = [];

  open(profile: string | null, observation: string | null): SettingsPage {
    const scope = JSON.stringify([profile, observation]);
    if (scope !== this.scope) {
      this.scope = scope;
      this.overview();
    }
    return this.page;
  }

  overview(): SettingsPage {
    this.history = [];
    return this.page = 'index';
  }

  enter(page: Exclude<SettingsPage, 'index'>): SettingsPage {
    if (page !== this.page) this.history.push(this.page);
    return this.page = page;
  }

  back(): SettingsPage {
    return this.page = this.history.pop() ?? parentSettingsPage(this.page);
  }
}
