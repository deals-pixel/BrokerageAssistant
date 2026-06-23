import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FormTemplateEditor } from "@/components/admin/form-template-editor";
import { Button } from "@/components/ui/button";

export default function StandardFormTemplatesPage() {
  return (
    <main>
      <div className="mx-auto max-w-[1500px] px-6 pt-6">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft />
          Dashboard
        </Button>
      </div>
      <FormTemplateEditor />
    </main>
  );
}
