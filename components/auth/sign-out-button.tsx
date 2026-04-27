"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      await authClient.signOut();
      router.push("/sign-in");
      router.refresh();
    });
  }

  return (
    <Button variant="ghost" size="sm" className={cn(className)} onClick={signOut} disabled={isPending}>
      <LogOut className="size-4" />
      Sair
    </Button>
  );
}
