"use client";

import { useEffect, useRef, useState } from "react";
import "rrweb-player/dist/style.css";
import { Loader2 } from "lucide-react";

type RecordingResponse = {
  ok: true;
  sessionId: string;
  events: unknown[];
};

export function BrowserbaseReplay({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<{ $destroy?: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setError(null);
      setLoading(true);
      try {
        const [response, mod] = await Promise.all([
          fetch(`/api/portal-sessions/${sessionId}/recording`),
          import("rrweb-player"),
        ]);
        if (cancelled) return;

        const payload = (await response.json().catch(() => null)) as
          | RecordingResponse
          | { ok: false; error?: { message?: string } }
          | null;

        if (!response.ok || !payload || !("ok" in payload) || !payload.ok) {
          const msg =
            (payload && "error" in payload && payload.error?.message) ||
            "Replay indisponível.";
          setError(msg);
          setLoading(false);
          return;
        }

        if (!Array.isArray(payload.events) || payload.events.length < 2) {
          setError("Replay vazio (sessão não gerou eventos suficientes).");
          setLoading(false);
          return;
        }

        if (!containerRef.current || cancelled) return;
        containerRef.current.innerHTML = "";

        const RRwebPlayer = mod.default as new (config: {
          target: HTMLElement;
          props: {
            events: unknown[];
            width?: number;
            height?: number;
            autoPlay?: boolean;
            showController?: boolean;
          };
        }) => { $destroy?: () => void };

        const width = containerRef.current.getBoundingClientRect().width || 960;
        playerRef.current = new RRwebPlayer({
          target: containerRef.current,
          props: {
            events: payload.events,
            width: Math.max(640, Math.floor(width)),
            height: Math.max(360, Math.floor((width * 9) / 16)),
            autoPlay: false,
            showController: true,
          },
        });
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar replay.");
        setLoading(false);
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
      try {
        playerRef.current?.$destroy?.();
      } catch {
        // ignore — component unmounting
      }
      playerRef.current = null;
    };
  }, [sessionId]);

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="flex h-[360px] items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando replay…
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <div ref={containerRef} className="overflow-hidden rounded-md border bg-background" />
    </div>
  );
}
