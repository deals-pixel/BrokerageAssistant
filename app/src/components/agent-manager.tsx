"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type AgentRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  brokerage: string | null;
};

export function AgentManager({ agents }: { agents: AgentRow[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    brokerage: "Sutton Group Admiral Realty",
  });

  async function createAgent() {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Name and email are required.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    try {
      const { error } = await supabase.from("agents").insert({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        brokerage: form.brokerage.trim() || null,
      });
      if (error) throw new Error(error.message);
      toast.success("Agent created.");
      setForm({ name: "", email: "", phone: "", brokerage: "Sutton Group Admiral Realty" });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create agent");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create Agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Name" value={form.name} onChange={(name) => setForm((prev) => ({ ...prev, name }))} />
          <Field label="Email" value={form.email} onChange={(email) => setForm((prev) => ({ ...prev, email }))} />
          <Field label="Phone" value={form.phone} onChange={(phone) => setForm((prev) => ({ ...prev, phone }))} />
          <Field
            label="Brokerage"
            value={form.brokerage}
            onChange={(brokerage) => setForm((prev) => ({ ...prev, brokerage }))}
          />
          <Button onClick={createAgent} disabled={saving}>
            Create Agent
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agents</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Brokerage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell className="font-medium">{agent.name}</TableCell>
                  <TableCell>{agent.email}</TableCell>
                  <TableCell>{agent.phone ?? "-"}</TableCell>
                  <TableCell>{agent.brokerage ?? "-"}</TableCell>
                </TableRow>
              ))}
              {agents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No agents yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
