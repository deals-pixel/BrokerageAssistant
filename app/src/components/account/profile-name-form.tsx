"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProfileNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    const response = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: name }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setLoading(false);

    if (!response.ok) {
      setError(body?.error ?? "Unable to update name.");
      return;
    }

    setSuccess(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSave} className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="space-y-2">
        <Label htmlFor="full-name">Name</Label>
        <Input
          id="full-name"
          value={name}
          maxLength={80}
          autoComplete="name"
          placeholder="Enter your name"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-700">Name updated.</p>}
      <Button type="submit" size="sm" disabled={loading}>
        {loading ? "Saving..." : "Save name"}
      </Button>
    </form>
  );
}
