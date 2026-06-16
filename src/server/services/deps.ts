import type { AppConfig } from '../config.js';
import type { Db } from '../../db/client.js';
import type { UserService } from './user.service.js';
import type { SettingsService } from './settings.service.js';
import type { RequestService } from './request.service.js';
import type { SearchService } from './search.service.js';
import type { OidcService, AutheliaProfile } from './oidc.service.js';
import type { PlexProfile } from './user.service.js';

/** Wired-up service container handed to the route registrars. */
export interface AppDeps {
  config: AppConfig;
  db: Db;
  users: UserService;
  settings: SettingsService;
  requests: RequestService;
  search: SearchService;
  /** null in AUTH_BYPASS mode (or if Plex OIDC isn't configured). */
  plexOidc: OidcService<PlexProfile> | null;
  /** Optional operator admin SSO; null unless Authelia OIDC is configured. */
  autheliaOidc: OidcService<AutheliaProfile> | null;
}
