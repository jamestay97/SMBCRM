import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function BusinessNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">Business not found</h1>
        <p className="mt-2 text-muted-foreground">
          This page may have moved or the business is not accepting requests
          right now. Copy the customer link from Dashboard → Settings — do not
          use placeholder URLs like <code>/b/your-business-slug</code>.
        </p>
        <Button className="mt-6" asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}
