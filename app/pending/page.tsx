import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isSessionApproved } from "@/lib/session";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Aguardando aprovação · DOC365",
};

export default async function PendingPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) redirect("/sign-in");
  if (await isSessionApproved(session)) redirect("/app/jobs");

  const email = session.user.email;
  const name = session.user.name;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Conta aguardando aprovação</CardTitle>
          <CardDescription>
            Sua conta foi criada com sucesso, mas precisa ser aprovada por um administrador antes
            que você possa acessar o sistema.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <p className="font-medium">{name ?? "Sem nome"}</p>
            <p className="text-muted-foreground">{email}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Você receberá acesso assim que um administrador aprovar a solicitação. Caso queira
            acelerar, entre em contato com o responsável pelo projeto.
          </p>
          <div className="flex justify-end">
            <SignOutButton />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
