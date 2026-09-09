import { requestUrl } from 'obsidian';

/**
 * Anonymous usage telemetry via self-hosted OpenPanel.
 *
 * Uses the public (secretless) ingest path: client-side events authenticate
 * with `openpanel-client-id` alone — no client secret is embedded in the
 * bundle. All event names and properties are allowlisted and coarse-grained:
 * no vault paths, filenames, counts-as-exact, passwords, keys, or contents.
 */

export const OPENPANEL_API_URL = 'https://openpanel.gventureshq.com';
export const OPENPANEL_CLIENT_ID = '30b43edf-1f2b-4859-accc-dc48a2dfb5b8';
const TELEMETRY_SDK_NAME = 'obsidian-encrypted-folders';
const TELEMETRY_SDK_VERSION = '1.0.0';
const REQUEST_TIMEOUT_MS = 5000;
const MAX_QUEUE_LENGTH = 20;

export type TelemetryEventName =
  | 'plugin_loaded'
  | 'plugin_unloaded'
  | 'folder_encrypted'
  | 'folder_unlocked'
  | 'folder_locked'
  | 'encryption_removed'
  | 'auto_lock_triggered'
  | 'error';

const ALLOWED_EVENTS: ReadonlySet<TelemetryEventName> = new Set([
  'plugin_loaded',
  'plugin_unloaded',
  'folder_encrypted',
  'folder_unlocked',
  'folder_locked',
  'encryption_removed',
  'auto_lock_triggered',
  'error',
]);

export type TelemetryProperties = Record<string, string | number | boolean>;

export interface TelemetryTransport {
  post(url: string, headers: Record<string, string>, body: string): Promise<void>;
}

export interface TelemetrySink {
  trackEvent(name: TelemetryEventName, properties?: TelemetryProperties): void;
}

interface QueuedEvent {
  name: TelemetryEventName;
  properties: TelemetryProperties;
}

export function bucketCount(count: number): string {
  if (count <= 10) {
    return '1-10';
  }
  if (count <= 100) {
    return '11-100';
  }
  return '100+';
}

const defaultTransport: TelemetryTransport = {
  async post(url: string, headers: Record<string, string>, body: string): Promise<void> {
    await requestUrl({
      url,
      method: 'POST',
      headers,
      body,
    });
  },
};

export class TelemetryService implements TelemetrySink {
  private queue: QueuedEvent[] = [];
  private sending = false;

  constructor(
    private getEnabled: () => boolean,
    private getProfileId: () => string,
    private getGlobalProperties: () => TelemetryProperties,
    private transport: TelemetryTransport = defaultTransport,
    private apiUrl: string = OPENPANEL_API_URL,
    private clientId: string = OPENPANEL_CLIENT_ID,
  ) {}

  trackEvent(name: TelemetryEventName, properties: TelemetryProperties = {}): void {
    if (!this.getEnabled()) {
      return;
    }
    if (!ALLOWED_EVENTS.has(name)) {
      return;
    }
    if (this.queue.length >= MAX_QUEUE_LENGTH) {
      return;
    }
    this.queue.push({ name, properties });
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.sending) {
      return;
    }
    this.sending = true;
    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift();
        if (!event) {
          break;
        }
        await this.send(event);
      }
    } finally {
      this.sending = false;
    }
  }

  private async send(event: QueuedEvent): Promise<void> {
    const body = JSON.stringify({
      type: 'track',
      payload: {
        name: event.name,
        profileId: this.getProfileId(),
        properties: {
          ...this.getGlobalProperties(),
          ...event.properties,
          __timestamp: new Date().toISOString(),
        },
      },
    });
    try {
      await Promise.race([
        this.transport.post(`${this.apiUrl}/track`, this.headers(), body),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('Telemetry request timed out.')), REQUEST_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Telemetry is best-effort and must never break plugin flows.
    }
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'openpanel-client-id': this.clientId,
      'openpanel-sdk-name': TELEMETRY_SDK_NAME,
      'openpanel-sdk-version': TELEMETRY_SDK_VERSION,
    };
  }
}

/** No-op sink for tests and contexts where telemetry is unavailable. */
export class NullTelemetryService implements TelemetrySink {
  trackEvent(): void {}
}
