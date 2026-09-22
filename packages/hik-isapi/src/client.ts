import { IsapiCore } from './core.js';
import type { DigestHttpOptions } from './digest.js';
import { AccessModule } from './modules/access.js';
import { EventsModule } from './modules/events.js';
import { FacesModule } from './modules/faces.js';
import { NotificationModule } from './modules/notification.js';
import { PersonsModule } from './modules/persons.js';
import { SystemModule } from './modules/system.js';

export type HikvisionClientOptions = DigestHttpOptions;

/**
 * Client for one Hikvision access control terminal.
 *
 * Each instance owns a connection pool and a cached Digest challenge, so keep
 * one instance per device for the lifetime of the process rather than creating
 * one per request. Instances are not safe to share across devices.
 */
export class HikvisionClient {
  readonly system: SystemModule;
  readonly persons: PersonsModule;
  readonly events: EventsModule;
  readonly faces: FacesModule;
  readonly notifications: NotificationModule;
  readonly access: AccessModule;

  private readonly core: IsapiCore;

  constructor(options: HikvisionClientOptions) {
    this.core = new IsapiCore(options);
    this.system = new SystemModule(this.core);
    this.persons = new PersonsModule(this.core);
    this.events = new EventsModule(this.core);
    this.faces = new FacesModule(this.core);
    this.notifications = new NotificationModule(this.core);
    this.access = new AccessModule(this.core);
  }

  get host(): string {
    return this.core.host;
  }

  /** Escape hatch for endpoints this library does not model yet. */
  get raw(): IsapiCore {
    return this.core;
  }

  async close(): Promise<void> {
    await this.core.close();
  }
}
