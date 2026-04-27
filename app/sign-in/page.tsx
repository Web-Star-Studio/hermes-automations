import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <AuthForm mode="sign-in" />
        <p className="text-center text-sm text-muted-foreground">
          Ainda nao tem conta?{" "}
          <Link className="text-foreground underline" href="/sign-up">
            Criar conta
          </Link>
        </p>
      </div>
    </main>
  );
}
