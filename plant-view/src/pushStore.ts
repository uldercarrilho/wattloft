export type PushSubscriptionRecord = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  subscribedAt?: string;
};

export const TRUSTED_PUSH_DOMAINS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "push.apple.com",
  "updates.push.services.mozilla.com",
  "notify.windows.com",
  ...(process.env.NODE_ENV === "test" ? ["push.example.com"] : []),
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      TRUSTED_PUSH_DOMAINS.some(
        (d) => url.hostname === d || url.hostname.endsWith(`.${d}`)
      )
    );
  } catch {
    return false;
  }
}

export class PushSubscriptionStore {
  private _subscriptions: Map<string, PushSubscriptionRecord> = new Map();

  save(sub: PushSubscriptionRecord): void {
    if (
      !sub ||
      typeof sub.endpoint !== "string" ||
      !isAllowedPushEndpoint(sub.endpoint) ||
      !sub.keys ||
      typeof sub.keys.p256dh !== "string" ||
      typeof sub.keys.auth !== "string"
    ) {
      throw new Error("Invalid push subscription");
    }
    this._subscriptions.set(sub.endpoint, {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
      },
      subscribedAt: new Date().toISOString(),
    });
  }

  remove(endpoint: string): boolean {
    return this._subscriptions.delete(endpoint);
  }

  list(): PushSubscriptionRecord[] {
    return Array.from(this._subscriptions.values());
  }

  clear(): void {
    this._subscriptions.clear();
  }
}
