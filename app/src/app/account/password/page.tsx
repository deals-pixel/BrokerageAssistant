import { redirect } from "next/navigation";

export default async function ChangePasswordRedirect({
  searchParams,
}: {
  searchParams?: Promise<{ recovery?: string }>;
}) {
  const params = await searchParams;
  redirect(params?.recovery ? "/account?recovery=1" : "/account");
}
