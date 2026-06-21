import Link from "next/link";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function PaymentCancelledPage({
  searchParams,
}: {
  searchParams: { lead_id?: string };
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-white px-4 py-12">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center space-y-3">
          <XCircle className="h-14 w-14 text-amber-600" />
          <CardTitle className="text-2xl">Payment not completed</CardTitle>
          <CardDescription className="text-base">
            No worries — your appointment isn&apos;t confirmed yet. You can use
            the deposit link we sent in chat to try again when you&apos;re ready.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Close</Link>
          </Button>
          {searchParams.lead_id ? (
            <p className="text-xs text-muted-foreground">
              Reference: {searchParams.lead_id.slice(0, 8)}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
