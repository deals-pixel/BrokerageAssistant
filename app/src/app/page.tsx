import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { UploadDropzone } from "@/components/upload-dropzone";
import { ProcessDealButton } from "@/components/process-deal-button";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  uploaded: "outline",
  processing: "secondary",
  extracted: "default",
  in_review: "default",
  reviewed: "default",
  exported: "secondary",
  error: "destructive",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: deals } = await supabase
    .from("deals")
    .select("id, file_name, status, transaction_type, property_address, page_count, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Deal Intake Assistant</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user?.email}</p>
        </div>
        <SignOutButton />
      </header>

      <UploadDropzone />

      <section>
        <h2 className="mb-3 text-lg font-medium">Recent packages</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Property / File</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Pages</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(deals ?? []).map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <Link href={`/deals/${d.id}`} className="font-medium hover:underline">
                    {d.property_address ?? d.file_name}
                  </Link>
                </TableCell>
                <TableCell className="capitalize">{d.transaction_type}</TableCell>
                <TableCell>{d.page_count ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[d.status] ?? "outline"}>{d.status}</Badge>
                </TableCell>
                <TableCell>{new Date(d.created_at).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <ProcessDealButton
                    dealId={d.id}
                    status={d.status}
                    pageCount={d.page_count}
                    variant={d.status === "uploaded" ? "default" : "outline"}
                  />
                </TableCell>
              </TableRow>
            ))}
            {(!deals || deals.length === 0) && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No packages yet — upload one above.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
