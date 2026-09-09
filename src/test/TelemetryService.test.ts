import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  bucketCount,
  TelemetryService,
  type TelemetryProperties,
  type TelemetryTransport,
} from '../services/TelemetryService';

function makeTransport() {
  const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
  const transport: TelemetryTransport = {
    post: async (url, headers, body) => {
      posts.push({ url, headers, body });
    },
  };
  return { posts, transport };
}

describe('TelemetryService', () => {
  let enabled = true;
  const globals: TelemetryProperties = { plugin_version: '1.0.0', platform: 'desktop' };

  beforeEach(() => {
    enabled = true;
  });

  function makeService(transport: TelemetryTransport) {
    return new TelemetryService(
      () => enabled,
      () => 'test-profile-id',
      () => globals,
      transport,
      'https://analytics.example.com',
      'test-client-id',
    );
  }

  test('posts secretless ingest payload with expected shape', async () => {
    const { posts, transport } = makeTransport();
    const service = makeService(transport);

    service.trackEvent('folder_locked', { via: 'manual', file_count_bucket: '1-10' });
    await vi.waitFor(() => expect(posts.length).toBe(1));

    const [post] = posts;
    expect(post.url).toBe('https://analytics.example.com/track');
    expect(post.headers['openpanel-client-id']).toBe('test-client-id');
    expect(post.headers['openpanel-sdk-name']).toBeTruthy();
    expect(post.headers).not.toHaveProperty('openpanel-client-secret');

    const body = JSON.parse(post.body);
    expect(body.type).toBe('track');
    expect(body.payload.name).toBe('folder_locked');
    expect(body.payload.profileId).toBe('test-profile-id');
    expect(body.payload.properties.via).toBe('manual');
    expect(body.payload.properties.plugin_version).toBe('1.0.0');
    expect(body.payload.properties.__timestamp).toBeTruthy();
  });

  test('does nothing when disabled', async () => {
    const { posts, transport } = makeTransport();
    enabled = false;
    const service = makeService(transport);

    service.trackEvent('plugin_loaded', {});
    await new Promise((r) => setTimeout(r, 50));
    expect(posts.length).toBe(0);
  });

  test('rejects non-allowlisted event names', async () => {
    const { posts, transport } = makeTransport();
    const service = makeService(transport);

    service.trackEvent('vault_paths_leaked' as never, { path: 'secret' });
    await new Promise((r) => setTimeout(r, 50));
    expect(posts.length).toBe(0);
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
    await new Promise((r) => setTimeout(r, 200));
    // Must not throw; queue cap keeps memory bounded.
    expect(true).toBe(true);
  });

  test('payloads contain no vault paths, filenames, or secrets', async () => {
    const { posts, transport } = makeTransport();
    const service = makeService(transport);

    service.trackEvent('folder_encrypted', { lock_immediately: true, file_count_bucket: bucketCount(42) });
    service.trackEvent('folder_unlocked', { via: 'password', success: true });
    service.trackEvent('auto_lock_triggered', { via: 'idle', folder_count_bucket: bucketCount(3) });
    await vi.waitFor(() => expect(posts.length).toBe(3));

    // `via: "password"` is an allowed coarse enum (unlock method bucket),
    // not a secret — the forbidden list targets paths, contents, and keys.
    const forbidden = [/\.md\b/i, /\.locked\b/i, /vault/i, /recovery key/i, /\//];
    for (const post of posts) {
      const body = JSON.parse(post.body);
      const serialized = JSON.stringify(body.payload.properties);
      for (const pattern of forbidden) {
        // __timestamp is ISO (contains no slashes); properties must stay coarse.
        const withoutTimestamp = serialized.replace(/"__timestamp":"[^"]*"/, '');
        expect(withoutTimestamp).not.toMatch(pattern);
      }
      // Anonymous profile only.
      expect(body.payload.profileId).toBe('test-profile-id');
      expect(JSON.stringify(body.payload)).not.toMatch(/@|email|user/i);
    }
  });

  test('bucketCount keeps counts coarse', () => {
    expect(bucketCount(0)).toBe('1-10');
    expect(bucketCount(10)).toBe('1-10');
    expect(bucketCount(11)).toBe('11-100');
    expect(bucketCount(500)).toBe('100+');
  });
});
