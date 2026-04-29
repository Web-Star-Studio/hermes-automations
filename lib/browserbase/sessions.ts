import { Browserbase } from "@browserbasehq/sdk";

let cachedClient: Browserbase | null = null;

function getClient(): Browserbase | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) return null;
  cachedClient = new Browserbase({ apiKey });
  return cachedClient;
}

export type BrowserbaseSessionDetails = {
  id: string;
  status: string | null;
  region: string | null;
  startedAt: string | null;
  endedAt: string | null;
  expiresAt: string | null;
  durationSeconds: number | null;
};

export async function getBrowserbaseSession(
  sessionId: string,
): Promise<BrowserbaseSessionDetails | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const session = await client.sessions.retrieve(sessionId);
    const startedAt = pickIso(session.startedAt);
    const endedAt = pickIso(session.endedAt);
    let duration: number | null = null;
    if (startedAt && endedAt) {
      const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
      if (Number.isFinite(ms) && ms >= 0) duration = Math.round(ms / 1000);
    }
    return {
      id: sessionId,
      status: session.status ?? null,
      region: session.region ?? null,
      startedAt,
      endedAt,
      expiresAt: pickIso(session.expiresAt),
      durationSeconds: duration,
    };
  } catch {
    return null;
  }
}

export type BrowserbaseRecordingEvent = {
  type: number;
  timestamp: number;
  data: Record<string, unknown>;
};

export async function getBrowserbaseRecording(
  sessionId: string,
): Promise<BrowserbaseRecordingEvent[] | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const events = (await client.sessions.recording.retrieve(sessionId)) as BrowserbaseRecordingEvent[];
    return Array.isArray(events) ? events : null;
  } catch {
    return null;
  }
}

function pickIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toISOString();
  return null;
}
