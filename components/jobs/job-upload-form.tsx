"use client";

import { Check, FileArchive, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FlowType = "short" | "complete";

type FlowOption = {
  value: FlowType;
  title: string;
  description: string;
  disabled?: boolean;
  badge?: string;
};

const flowOptions: FlowOption[] = [
  {
    value: "short",
    title: "Fluxo curto",
    description:
      "Envio direto: extração TISS, validação humana, login no portal e envio do lote. Recomendado para a maioria dos lotes.",
  },
  {
    value: "complete",
    title: "Fluxo completo",
    description:
      "Digitação guia a guia no portal (Operadora + Tipo de Guia, etapas e procedimentos). Em desenvolvimento — habilitaremos quando o fluxo estiver estável.",
    disabled: true,
    badge: "Em desenvolvimento",
  },
];

const MAX_FILES = 50;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function JobUploadForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [flowType, setFlowType] = useState<FlowType>("short");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files ?? []);
    if (incoming.length === 0) return;
    setError(null);
    setSelectedFiles((prev) => {
      const merged = [...prev];
      for (const f of incoming) {
        if (!merged.some((existing) => existing.name === f.name && existing.size === f.size)) {
          merged.push(f);
        }
      }
      if (merged.length > MAX_FILES) {
        setError(`Limite máximo de ${MAX_FILES} arquivos por envio.`);
        return merged.slice(0, MAX_FILES);
      }
      return merged;
    });
    // Reset the input so re-selecting the same file fires onChange again.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (selectedFiles.length === 0) {
      setError("Selecione ao menos um arquivo.");
      return;
    }

    setIsPending(true);

    const formData = new FormData();
    formData.set("flowType", flowType);
    for (const file of selectedFiles) {
      formData.append("file", file);
    }

    const response = await fetch("/api/jobs/upload", {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => null);
    setIsPending(false);

    if (!response.ok || !data?.ok) {
      setError(data?.error?.message ?? "Não foi possível enviar o arquivo.");
      return;
    }

    router.push(`/app/jobs/${data.jobId}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Novo job</CardTitle>
        <CardDescription>
          Escolha o fluxo de envio e envie um ou mais XML TISS / ZIP (até {MAX_FILES} por envio).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={onSubmit}>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Fluxo do envio</legend>
            <div className="grid gap-3 md:grid-cols-2" role="radiogroup">
              {flowOptions.map((option) => {
                const selected = option.value === flowType;
                const disabled = option.disabled === true;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-disabled={disabled}
                    disabled={disabled}
                    title={disabled ? "Fluxo em desenvolvimento. Em breve." : undefined}
                    onClick={() => {
                      if (disabled) return;
                      setFlowType(option.value);
                    }}
                    className={cn(
                      "group relative rounded-md border bg-card p-4 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      disabled
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer hover:border-primary/60",
                      selected && !disabled && "border-primary bg-primary/5",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{option.title}</span>
                        {option.badge ? (
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                            {option.badge}
                          </Badge>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full border",
                          selected && !disabled
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40",
                        )}
                      >
                        {selected && !disabled ? <Check className="size-3" /> : null}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="file">Arquivos</Label>
            <Input
              id="file"
              name="file"
              type="file"
              accept=".xml,.zip"
              multiple
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <p className="text-xs text-muted-foreground">
              Selecione 1 a {MAX_FILES} arquivos. Clique mais de uma vez para acumular seleções.
            </p>
          </div>

          {selectedFiles.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  {selectedFiles.length} arquivo{selectedFiles.length > 1 ? "s" : ""} selecionado
                  {selectedFiles.length > 1 ? "s" : ""}
                </Label>
                <button
                  type="button"
                  onClick={() => setSelectedFiles([])}
                  className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Limpar tudo
                </button>
              </div>
              <ul className="space-y-1 rounded-md border p-2">
                {selectedFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex items-center justify-between gap-2 rounded-sm px-2 py-1 hover:bg-muted"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileArchive className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm">{file.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatSize(file.size)}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remover ${file.name}`}
                      onClick={() => removeFile(index)}
                      className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" disabled={isPending || selectedFiles.length === 0}>
            <Upload className="size-4" />
            {isPending
              ? "Enviando..."
              : selectedFiles.length > 1
                ? `Enviar ${selectedFiles.length} arquivos e analisar`
                : "Enviar e analisar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
