import { requestUrl } from 'obsidian';

declare global {
  interface ImportMeta {
    readonly env: {
      readonly OPENPANEL_CLIENT_ID?: string;
      readonly OPENPANEL_CLIENT_SECRET?: string;
    };
  }
}

/**
 * Anonymous usage telemetry via self-hosted OpenPanel.
 *
 * This host accepts `POST {apiUrl}/track` only when the project client id and
 * client secret are both present. Those values are injected at build time and
 * are omitted from source. Events stay allowlisted and coarse: no vault paths,
 * filenames, exact counts, passwords, keys, or contents.
 */

export const OPENPANEL_API_URL = 'https://openpanel.gventureshq.com/api';
export const OPENPANEL_CLIENT_ID = readBuildCredential(import.meta.env.OPENPANEL_CLIENT_ID);
export const OPENPANEL_CLIENT_SECRET = readBuildCredential(import.meta.env.OPENPANEL_CLIENT_SECRET);

const TELEMETRY_SDK_NAME = 'obsidian-encrypted-folders';
const ATTEMPT_TIMEOUT_MS = 2500;
const RETRY_DELAY_MS = 200;
const TRANSIENT_RETRIES = 1;
const MAX_QUEUE_LENGTH = 20;
const MAX_ERROR_SNIPPET = 160;

export type TelemetryEventName =
  | 'plugin_loaded'
  | 'plugin_unloaded'
  | 'folder_encrypted'
  | 'folder_unlocked'
  | 'folder_locked'
  | 'encryption_removed'
  | 'auto_lock_triggered'
  | 'master_password_setup'
  | 'master_password_changed'
  | 'master_password_removed'
  | 'password_converted'
  | 'password_relabelled'
  | 'custom_password_changed'
  | 'error';

const ALLOWED_EVENTS: ReadonlySet<TelemetryEventName> = new Set([
  'plugin_loaded',
  'plugin_unloaded',
  'folder_encrypted',
  'folder_unlocked',
  'folder_locked',
  'encryption_removed',
  'auto_lock_triggered',
  'master_password_setup',
  'master_password_changed',
  'master_password_removed',
  'password_converted',
  'password_relabelled',
  'custom_password_changed',
  'error',
]);

export type TelemetryProperties = Record<string, string | number | boolean>;

export interface TelemetryPlatform {
  isIosApp: boolean;
  isAndroidApp: boolean;
  isWin: boolean;
  isLinux: boolean;
  isMacOS: boolean;
  isMobile: boolean;
}

export interface TelemetryContext {
  pluginVersion: string;
  os: string;
  device: 'desktop' | 'mobile';
  platform: 'desktop' | 'mobile';
}

export interface TelemetryResult {
  status: number;
  body: string;
}

export interface TelemetryTransport {
  post(url: string, headers: Record<string, string>, body: string): Promise<TelemetryResult>;
}

export interface TelemetrySink {
  trackEvent(name: TelemetryEventName, properties?: TelemetryProperties): void;
}

export interface TelemetryServiceOptions {
  transport?: TelemetryTransport;
  apiUrl?: string;
  clientId?: string;
  clientSecret?: string;
  getDebugLogging?: () => boolean;
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

/** OpenPanel groups Macs under "macOS". iOS is checked first because Obsidian reports iPhones as macOS too. */
export function telemetryOs(platform: TelemetryPlatform): string {
  if (platform.isIosApp) {
    return 'iOS';
  }
  if (platform.isAndroidApp) {
    return 'Android';
  }
  if (platform.isWin) {
    return 'Windows';
  }
  if (platform.isLinux) {
    return 'Linux';
  }
  if (platform.isMacOS) {
    return 'macOS';
  }
  return 'unknown';
}

export function telemetryDevice(platform: TelemetryPlatform): 'desktop' | 'mobile' {
  return platform.isMobile ? 'mobile' : 'desktop';
}

function readBuildCredential(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function trackUrl(apiUrl: string): string {
  const base = apiUrl.trim().replace(/\/+$/, '');
  if (base.endsWith('/track')) {
    return base;
  }
  return `${base}/track`;
}

function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

const defaultTransport: TelemetryTransport = {
  async post(url: string, headers: Record<string, string>, body: string): Promise<TelemetryResult> {
    const response = await requestUrl({
      url,
      method: 'POST',
      contentType: 'application/json',
      headers,
      body,
      throw: false,
    });
    return { status: response.status, body: response.text };
  },
};

export class TelemetryService implements TelemetrySink {
  private queue: QueuedEvent[] = [];
  private sending = false;
  private readonly transport: TelemetryTransport;
  private readonly apiUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly getDebugLogging: () => boolean;

  constructor(
    private getEnabled: () => boolean,
    private getProfileId: () => string,
    private getContext: () => TelemetryContext,
    options: TelemetryServiceOptions = {},
  ) {
    this.transport = options.transport ?? defaultTransport;
    this.apiUrl = options.apiUrl ?? OPENPANEL_API_URL;
    this.clientId = (options.clientId ?? OPENPANEL_CLIENT_ID).trim();
    this.clientSecret = (options.clientSecret ?? OPENPANEL_CLIENT_SECRET).trim();
    this.getDebugLogging = options.getDebugLogging ?? (() => false);
  }

  trackEvent(name: TelemetryEventName, properties: TelemetryProperties = {}): void {
    if (!this.getEnabled() || !this.credentialsConfigured()) {
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

  private credentialsConfigured(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
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
    const body = JSON.stringify(this.buildBody(event));
    const url = trackUrl(this.apiUrl);
    const headers = this.headers();
    let lastStatus = 0;
    let lastBody = '';

    for (let attempt = 0; attempt <= TRANSIENT_RETRIES; attempt++) {
      if (attempt > 0) {
        await delay(RETRY_DELAY_MS);
      }
      try {
        const result = await this.postOnce(url, headers, body);
        if (result.status < 400) {
          return;
        }
        lastStatus = result.status;
        lastBody = result.body;
        if (!isTransientStatus(result.status)) {
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.debug(`Telemetry dispatch error: ${message}`);
        return;
      }
    }

    if (lastStatus >= 400) {
      const snippet = this.snippet(lastBody);
      this.debug(
        snippet.length > 0
          ? `Telemetry returned HTTP ${lastStatus}: ${snippet}`
          : `Telemetry returned HTTP ${lastStatus}`,
      );
    }
  }

  private async postOnce(url: string, headers: Record<string, string>, body: string): Promise<TelemetryResult> {
    return await Promise.race([
      this.transport.post(url, headers, body),
      new Promise<TelemetryResult>((_, reject) => {
        window.setTimeout(() => reject(new Error('Telemetry request timed out.')), ATTEMPT_TIMEOUT_MS);
      }),
    ]);
  }

  private buildBody(event: QueuedEvent): { type: 'track'; payload: Record<string, unknown> } {
    const context = this.getContext();
    const profileId = this.getProfileId();
    return {
      type: 'track',
      payload: {
        name: event.name,
        profileId,
        properties: {
          plugin_version: context.pluginVersion,
          platform: context.platform,
          ...event.properties,
          __os: context.os,
          __device: context.device,
          __identify: {
            profileId,
            properties: {
              plugin_version: context.pluginVersion,
              os: context.os,
              platform: context.platform,
            },
          },
          __timestamp: new Date().toISOString(),
        },
      },
    };
  }

  private headers(): Record<string, string> {
    const context = this.getContext();
    const version = context.pluginVersion || 'dev';
    return {
      'Content-Type': 'application/json',
      'User-Agent': `encrypted-folders/${version} (${context.os}; obsidian)`,
      'openpanel-client-id': this.clientId,
      'openpanel-client-secret': this.clientSecret,
      'openpanel-sdk-name': TELEMETRY_SDK_NAME,
      'openpanel-sdk-version': version,
    };
  }

  private snippet(body: string): string {
    const oneLine = body.replace(/\s+/g, ' ').trim();
    if (oneLine.length === 0) {
      return '';
    }
    const clipped = oneLine.length > MAX_ERROR_SNIPPET ? oneLine.slice(0, MAX_ERROR_SNIPPET) : oneLine;
    return this.redact(clipped);
  }

  private redact(text: string): string {
    if (this.clientSecret.length < 8) {
      return text;
    }
    return text.split(this.clientSecret).join('[secret]');
  }

  private debug(message: string): void {
    if (!this.getDebugLogging()) {
      return;
    }
    // oxlint-disable-next-line no-console -- debugLogging is the opt-in logging sink
    console.debug(`[EncryptedFolders] ${this.redact(message)}`);
  }
}

/** No-op sink for tests and contexts where telemetry is unavailable. */
export class NullTelemetryService implements TelemetrySink {
  trackEvent(): void {}
}
