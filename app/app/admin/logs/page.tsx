import { AdminLogsView } from "@/components/admin/admin-logs-view";

export const metadata = {
  title: "Logs · Admin",
};

export default function AdminLogsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Logs de auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Histórico completo de ações de usuários e jobs do sistema.
        </p>
      </div>
      <AdminLogsView />
    </div>
  );
}
