import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isConfigured, verifySession } from "@/lib/auth";
import { signIn } from "./actions";

const MESSAGES: Record<string, string> = {
  bad: "That name and password do not match. Try again.",
  locked: "Too many attempts from here. Wait fifteen minutes and try again.",
  unconfigured:
    "No credentials are set on this server. Set APP_USERNAME and APP_PASSWORD, then restart it.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const error = typeof params.error === "string" ? MESSAGES[params.error] : undefined;

  const jar = await cookies();
  if (verifySession(jar.get(SESSION_COOKIE)?.value)) redirect(next.startsWith("/") ? next : "/");

  return (
    <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-16">
      <section className="panel rounded-2xl p-8 sm:p-10 w-full max-w-sm relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px rule" />

        <header className="mb-8">
          <p className="mono text-[10px] tracking-[0.32em] text-brass/70 uppercase">
            Closed session
          </p>
          <h1 className="display text-3xl mt-1">The court is private</h1>
          <p className="text-sm text-muted mt-3 leading-relaxed">
            Twelve jurors sit behind this door. Identify yourself to be admitted.
          </p>
        </header>

        <form action={signIn} className="space-y-5">
          <input type="hidden" name="next" value={next} />

          <label className="block">
            <span className="mono text-[10px] tracking-[0.24em] uppercase text-muted">Name</span>
            <input
              name="username"
              autoComplete="username"
              autoFocus
              required
              className="mt-2 w-full bg-black/30 border border-white/8 rounded-lg px-4 py-2.5 text-sm
                         outline-none focus:border-brass/50 focus:bg-black/45 transition-colors"
            />
          </label>

          <label className="block">
            <span className="mono text-[10px] tracking-[0.24em] uppercase text-muted">
              Password
            </span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-2 w-full bg-black/30 border border-white/8 rounded-lg px-4 py-2.5 text-sm
                         outline-none focus:border-brass/50 focus:bg-black/45 transition-colors"
            />
          </label>

          {error && (
            <p className="text-sm leading-relaxed" style={{ color: "var(--for)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!isConfigured()}
            className="w-full px-7 py-3.5 rounded-lg border border-brass/45
                       disabled:opacity-35 disabled:cursor-not-allowed
                       enabled:hover:border-brass enabled:hover:bg-brass/10 transition-colors"
          >
            <span className="mono text-[11px] tracking-[0.28em] uppercase text-brass-lit">
              Be admitted
            </span>
          </button>
        </form>
      </section>
    </main>
  );
}
