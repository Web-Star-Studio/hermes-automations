"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JobUploadForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/jobs/upload", {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => null);
    setIsPending(false);

    if (!response.ok || !data?.ok) {
      setError(data?.error?.message ?? "Nao foi possivel enviar o arquivo.");
      return;
    }

    router.push(`/app/jobs/${data.jobId}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Novo job</CardTitle>
        <CardDescription>Envie um XML TISS ou ZIP contendo XMLs TISS.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="file">Arquivo</Label>
            <Input id="file" name="file" type="file" accept=".xml,.zip" required />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" disabled={isPending}>
            <Upload className="size-4" />
            {isPending ? "Enviando..." : "Enviar e analisar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
