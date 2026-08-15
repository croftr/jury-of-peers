"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkCredentials,
  clearAttempts,
  isConfigured,
  issueSession,
  recordFailure,
  sessionCookie,
  tooManyAttempts,
} from "@/lib/auth";

/** Only same-origin paths, so `?next=` cannot be pointed at another site. */
function safeNext(value: FormDataEntryValue | null): string {
  const path = typeof value === "string" ? value : "";
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  return path;
}

async function clientAddress(): Promise<string> {
  const head = await headers();
  const forwarded = head.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || head.get("x-real-ip") || "unknown";
}

export async function signIn(formData: FormData) {
  const next = safeNext(formData.get("next"));

  if (!isConfigured()) redirect(`/login?error=unconfigured&next=${encodeURIComponent(next)}`);

  const who = await clientAddress();
  if (tooManyAttempts(who)) redirect(`/login?error=locked&next=${encodeURIComponent(next)}`);

  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!checkCredentials(username, password)) {
    recordFailure(who);
    // A deliberate pause: enough to make a scripted run tedious, short enough
    // that a mistyped password is not annoying.
    await new Promise((resolve) => setTimeout(resolve, 400));
    redirect(`/login?error=bad&next=${encodeURIComponent(next)}`);
  }

  clearAttempts(who);
  const jar = await cookies();
  jar.set(sessionCookie(issueSession()));
  redirect(next);
}
