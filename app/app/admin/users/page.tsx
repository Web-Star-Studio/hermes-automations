import { AdminUsersView } from "@/components/admin/admin-users-view";

export const metadata = {
  title: "Usuários · Admin",
};

export default function AdminUsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
        <p className="text-sm text-muted-foreground">
          Aprove novos cadastros, revise status e bloqueie contas.
        </p>
      </div>
      <AdminUsersView />
    </div>
  );
}
