export function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gradient-bg noise-overlay px-4">
      <div className="glass-card w-full max-w-sm rounded-2xl p-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          <span className="text-primary">narrator</span>request
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Request audiobooks for the library.</p>
        <a
          href="/api/auth/login"
          className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground transition-all hover:opacity-90 focus-ring"
        >
          Sign in with Plex
        </a>
        {/* Operator admin SSO — only wired up if Authelia OIDC is configured. */}
        <a
          href="/api/auth/authelia/login"
          className="mt-4 inline-block text-xs text-muted-foreground/70 underline-offset-4 hover:text-muted-foreground hover:underline"
        >
          Admin sign-in
        </a>
      </div>
    </div>
  );
}
