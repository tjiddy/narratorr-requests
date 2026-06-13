export function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          <span className="text-violet-400">narrator</span>request
        </h1>
        <p className="mt-2 text-sm text-slate-400">Request audiobooks for the library.</p>
        <a
          href="/api/auth/login"
          className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-violet-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-violet-500"
        >
          Sign in with Plex
        </a>
      </div>
    </div>
  );
}
