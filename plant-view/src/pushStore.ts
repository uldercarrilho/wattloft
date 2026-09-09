export type PushSubscriptionRecord = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  subscribedAt?: string;
};

export class PushSubscriptionStore {
  private _subscriptions: Map<string, PushSubscriptionRecord> = new Map();

  save(sub: PushSubscriptionRecord): void {
    if (
      !sub ||
      typeof sub.endpoint !== "string" ||
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
