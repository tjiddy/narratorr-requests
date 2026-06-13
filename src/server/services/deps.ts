import type { AppConfig } from '../config.js';
import type { UserService } from './user.service.js';
import type { SettingsService } from './settings.service.js';
import type { RequestService } from './request.service.js';
import type { SearchService } from './search.service.js';
import type { PlexOidcService } from './plex-oidc.service.js';

/** Wired-up service container handed to the route registrars. */
export interface AppDeps {
  config: AppConfig;
  users: UserService;
  settings: SettingsService;
  requests: RequestService;
  search: SearchService;
  /** null in AUTH_BYPASS mode. */
  plexOidc: PlexOidcService | null;
}
