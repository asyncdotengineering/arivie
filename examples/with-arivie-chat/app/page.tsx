/* SPDX-License-Identifier: Apache-2.0 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppChat } from "@/components/app-chat";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  return (
    <AppChat userId={session.user.id} userEmail={session.user.email} />
  );
}
