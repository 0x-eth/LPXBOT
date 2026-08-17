import {
  monitorWindowMinutes,
  notificationDeliveryStatuses,
  type NotificationDeliveryStatus,
  type NotificationHistoryItem,
  type NotificationHistoryPage,
} from "@lpbot/api-contract";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface StoredNotificationHistoryItem extends NotificationHistoryItem {
  userId: string;
}

export interface NotificationHistoryQuery {
  cursor: { createdAt: string; deliveryId: string } | null;
  deliveryStatus: NotificationDeliveryStatus | null;
  from: string | null;
  limit: number;
  monitorId: string | null;
  to: string | null;
}

export interface NotificationHistoryStore {
  list(userId: string, query: NotificationHistoryQuery): Promise<NotificationHistoryPage>;
}

export class NotificationHistoryQueryError extends Error {
  constructor() {
    super("INVALID_NOTIFICATION_HISTORY_QUERY");
    this.name = "NotificationHistoryQueryError";
  }
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") throw new NotificationHistoryQueryError();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new NotificationHistoryQueryError();
  return new Date(milliseconds).toISOString();
}

export function encodeNotificationHistoryCursor(input: {
  createdAt: string;
  deliveryId: string;
}): string {
  return Buffer.from(JSON.stringify([input.createdAt, input.deliveryId]), "utf8").toString(
    "base64url",
  );
}

export function decodeNotificationHistoryCursor(value: unknown): {
  createdAt: string;
  deliveryId: string;
} {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    throw new NotificationHistoryQueryError();
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== "string" ||
      new Date(decoded[0]).toISOString() !== decoded[0] ||
      typeof decoded[1] !== "string" ||
      !uuidPattern.test(decoded[1])
    ) {
      throw new NotificationHistoryQueryError();
    }
    return { createdAt: decoded[0], deliveryId: decoded[1].toLowerCase() };
  } catch (error) {
    if (error instanceof NotificationHistoryQueryError) throw error;
    throw new NotificationHistoryQueryError();
  }
}

export function parseNotificationHistoryQuery(value: unknown): NotificationHistoryQuery {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NotificationHistoryQueryError();
  }
  const query = value as Record<string, unknown>;
  const allowed = new Set(["cursor", "deliveryStatus", "from", "limit", "monitorId", "to"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) {
    throw new NotificationHistoryQueryError();
  }
  const rawLimit = query.limit ?? "25";
  if (typeof rawLimit !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(rawLimit)) {
    throw new NotificationHistoryQueryError();
  }
  const monitorId = query.monitorId ?? null;
  if (monitorId !== null && (typeof monitorId !== "string" || !uuidPattern.test(monitorId))) {
    throw new NotificationHistoryQueryError();
  }
  const deliveryStatus = query.deliveryStatus ?? null;
  if (
    deliveryStatus !== null &&
    (typeof deliveryStatus !== "string" ||
      !notificationDeliveryStatuses.includes(deliveryStatus as NotificationDeliveryStatus))
  ) {
    throw new NotificationHistoryQueryError();
  }
  const from = query.from === undefined ? null : timestamp(query.from);
  const to = query.to === undefined ? null : timestamp(query.to);
  if (from !== null && to !== null && from > to) throw new NotificationHistoryQueryError();
  return {
    cursor: query.cursor === undefined ? null : decodeNotificationHistoryCursor(query.cursor),
    deliveryStatus: deliveryStatus as NotificationDeliveryStatus | null,
    from,
    limit: Number(rawLimit),
    monitorId: typeof monitorId === "string" ? monitorId.toLowerCase() : null,
    to,
  };
}

function publicItem({ userId: _userId, ...item }: StoredNotificationHistoryItem) {
  return structuredClone(item);
}

function assertStoredItem(item: StoredNotificationHistoryItem): void {
  if (
    !uuidPattern.test(item.deliveryId) ||
    !uuidPattern.test(item.monitorId) ||
    !notificationDeliveryStatuses.includes(item.status) ||
    !monitorWindowMinutes.includes(item.windowMinutes)
  ) {
    throw new RangeError("NOTIFICATION_HISTORY_ITEM_INVALID");
  }
}

export class MemoryNotificationHistoryStore implements NotificationHistoryStore {
  readonly #items: StoredNotificationHistoryItem[];

  constructor(items: readonly StoredNotificationHistoryItem[] = []) {
    for (const item of items) assertStoredItem(item);
    this.#items = items.map((item) => structuredClone(item));
  }

  async list(userId: string, query: NotificationHistoryQuery): Promise<NotificationHistoryPage> {
    const filtered = this.#items
      .filter((item) => item.userId === userId)
      .filter((item) => query.monitorId === null || item.monitorId === query.monitorId)
      .filter((item) => query.deliveryStatus === null || item.status === query.deliveryStatus)
      .filter((item) => query.from === null || item.createdAt >= query.from)
      .filter((item) => query.to === null || item.createdAt <= query.to)
      .filter(
        (item) =>
          query.cursor === null ||
          item.createdAt < query.cursor.createdAt ||
          (item.createdAt === query.cursor.createdAt &&
            item.deliveryId.localeCompare(query.cursor.deliveryId) < 0),
      )
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.deliveryId.localeCompare(left.deliveryId),
      );
    const page = filtered.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(publicItem),
      nextCursor:
        filtered.length > page.length && last
          ? encodeNotificationHistoryCursor({
              createdAt: last.createdAt,
              deliveryId: last.deliveryId,
            })
          : null,
    };
  }
}
