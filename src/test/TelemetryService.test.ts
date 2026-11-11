import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  bucketCount,
  TelemetryService,
  telemetryDevice,
  telemetryOs,
  type TelemetryContext,
  type TelemetryResult,
  type TelemetryTransport,
} from '../services/TelemetryService';

const context: TelemetryContext = {
  pluginVersion: '1.0.0',
  os: 'macOS',
  device: 'desktop',
  platform: 'desktop',
};

function makeTransport(result: TelemetryResult | ((call: number) => TelemetryResult) = { status: 200, body: '' }) {
  const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
  const transport: TelemetryTransport = {
    post: async (url, headers, body) => {
      posts.push({ url, headers, body });
      return typeof result === 'function' ? result(posts.length) : result;
    },
  };
  return { posts, transport };
}

describe('TelemetryService', () => {
  let enabled = true;

  beforeEach(() => {
    enabled = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeService(
    transport: TelemetryTransport,
    options: { clientId?: string; clientSecret?: string; getDebugLogging?: () => boolean } = {},
  ) {
    return new TelemetryService(
      () => enabled,
      () => 'test-profile-id',
      () => context,
      {
        transport,
        apiUrl: 'https://analytics.example.com/api',
        clientId: options.clientId ?? 'test-client-id',
        clientSecret: options.clientSecret ?? 'test-client-secret',
        getDebugLogging: options.getDebugLogging ?? (() => false),
      },
    );
  }

  test('posts project credentials and client hints', async () => {
    const { posts, transport } = makeTransport();
    const service = makeService(transport);

    service.trackEvent('folder_locked', { via: 'manual', file_count_bucket: '1-10' });
    await vi.waitFor(() => expect(posts.length).toBe(1));

    const [post] = posts;
    expect(post.url).toBe('https://analytics.example.com/api/track');
    expect(post.headers['openpanel-client-id']).toBe('test-client-id');
    expect(post.headers['openpanel-client-secret']).toBe('test-client-secret');
    expect(post.headers['openpanel-sdk-name']).toBe('obsidian-encrypted-folders');
    expect(post.headers['User-Agent']).toBe('encrypted-folders/1.0.0 (macOS; obsidian)');

    const body = JSON.parse(post.body);
    expect(body.type).toBe('track');
    expect(body.payload.name).toBe('folder_locked');
    expect(body.payload.profileId).toBe('test-profile-id');
    expect(body.payload.properties.via).toBe('manual');
    expect(body.payload.properties.plugin_version).toBe('1.0.0');
    expect(body.payload.properties['__os']).toBe('macOS');
    expect(body.payload.properties['__device']).toBe('desktop');
    expect(body.payload.properties['__identify']).toEqual({
      profileId: 'test-profile-id',
      properties: { plugin_version: '1.0.0', os: 'macOS', platform: 'desktop' },
    });
    expect(body.payload.properties['__timestamp']).toBeTruthy();
  });

  test('does nothing when disabled', async () => {
    const { posts, transport } = makeTransport();
    enabled = false;
    const service = makeService(transport);

    service.trackEvent('plugin_loaded', {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts.length).toBe(0);
  });

  test('does nothing when project credentials are missing', async () => {
    const { posts, transport } = makeTransport();
    const missingId = makeService(transport, { clientId: '' });
    const missingSecret = makeService(transport, { clientSecret: '' });

    missingId.trackEvent('plugin_loaded', {});
    missingSecret.trackEvent('plugin_loaded', {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts.length).toBe(0);
  });

  test('rejects non-allowlisted event names', async () => {
    const { posts, transport } = makeTransport();
    const service = makeService(transport);

    service.trackEvent('vault_paths_leaked' as never, { path: 'secret' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts.length).toBe(0);
  });

  test('retries a gateway failure once and does not retry a rejected event', async () => {
    const gateway = makeTransport((call) => ({ status: call === 1 ? 502 : 200, body: 'error code: 502' }));
    const service = makeService(gateway.transport);
    service.trackEvent('plugin_loaded', {});
    await vi.waitFor(() => expect(gateway.posts.length).toBe(2));

    const rejected = makeTransport({ status: 400, body: 'body/type Invalid input' });
    const rejectedService = makeService(rejected.transport);
    rejectedService.trackEvent('plugin_loaded', {});
    await vi.waitFor(() => expect(rejected.posts.length).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(rejected.posts.length).toBe(1);
  });

  test('debug logging redacts the client secret', async () => {
    const { posts, transport } = makeTransport({
      status: 400,
      body: 'rejected test-client-secret token',
    });
    const messages: string[] = [];
    vi.spyOn(console, 'debug').mockImplementation((message?: unknown) => {
      messages.push(String(message));
    });
    const service = makeService(transport, { getDebugLogging: () => true });

    service.trackEvent('plugin_loaded', {});
    await vi.waitFor(() => expect(posts.length).toBe(1));
    await vi.waitFor(() => expect(messages.length).toBe(1));

    expect(messages[0]).toContain('HTTP 400');
    expect(messages[0]).toContain('[secret]');
    expect(messages[0]).not.toContain('test-client-secret');
  });

  test('caps the queue and never throws on transport failure', async () => {
    const failing: TelemetryTransport = {
      post: async () => {
        throw new Error('network down');
      },
    };
    const service = makeService(failing);

    for (let i = 0; i < 50; i++) {
      service.trackEvent('plugin_loaded', {});
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(true).toBe(true);
  });

  test('payloads contain no vault paths, filenames, or secrets', async () => {
    const { posts, transport } = makeTransport();
    const service = makeService(transport);

    service.trackEvent('folder_encrypted', { lock_immediately: true, file_count_bucket: bucketCount(42) });
    service.trackEvent('folder_unlocked', { via: 'password', success: true });
    service.trackEvent('auto_lock_triggered', { via: 'idle', folder_count_bucket: bucketCount(3) });
    await vi.waitFor(() => expect(posts.length).toBe(3));

    const forbidden = [/\.md\b/i, /\.locked\b/i, /vault/i, /recovery key/i, /\//];
    for (const post of posts) {
      const body = JSON.parse(post.body);
      const serialized = JSON.stringify(body.payload.properties);
      const withoutTimestamp = serialized.replace(/"__timestamp":"[^"]*"/, '');
      for (const pattern of forbidden) {
        expect(withoutTimestamp).not.toMatch(pattern);
      }
      expect(body.payload.profileId).toBe('test-profile-id');
      expect(JSON.stringify(body.payload)).not.toMatch(/@|email|user/i);
      expect(post.headers['openpanel-client-secret']).toBe('test-client-secret');
    }
  });

  test('bucketCount keeps counts coarse', () => {
    expect(bucketCount(0)).toBe('1-10');
    expect(bucketCount(10)).toBe('1-10');
    expect(bucketCount(11)).toBe('11-100');
    expect(bucketCount(500)).toBe('100+');
  });

  test('telemetryOs prefers the specific mobile platform', () => {
    expect(
      telemetryOs({
        isIosApp: true,
        isAndroidApp: false,
        isWin: false,
        isLinux: false,
        isMacOS: true,
        isMobile: true,
      }),
    ).toBe('iOS');
    expect(
      telemetryOs({
        isIosApp: false,
        isAndroidApp: false,
        isWin: false,
        isLinux: false,
        isMacOS: true,
        isMobile: false,
      }),
    ).toBe('macOS');
    expect(
      telemetryDevice({
        isIosApp: false,
        isAndroidApp: true,
        isWin: false,
        isLinux: false,
        isMacOS: false,
        isMobile: true,
      }),
    ).toBe('mobile');
  });
});
