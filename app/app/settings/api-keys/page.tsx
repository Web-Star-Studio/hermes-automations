import { ApiKeysCard } from "@/components/settings/api-keys-card";

export default function ApiKeysSettingsPage() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">API Keys</h1>
        <p className="text-sm text-muted-foreground">
          Use estas chaves para chamar <code className="font-mono">/api/v1/*</code> de outros sistemas.
        </p>
      </div>
      <ApiKeysCard />
    </section>
  );
}
