"use client";

/**
 * Last-resort boundary. Anything that escapes a route's own error handling
 * lands here, so a crash shows something honest instead of a blank page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0a0c",
          color: "#d2d2da",
          fontFamily:
            'ui-sans-serif, -apple-system, "Segoe UI", Inter, system-ui, sans-serif',
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <p
            style={{
              fontSize: 10,
              letterSpacing: "0.11em",
              textTransform: "uppercase",
              fontWeight: 600,
              color: "#d4736b",
              margin: 0,
            }}
          >
            Something broke
          </p>
          <h1
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "#eeeef2",
              margin: "12px 0 8px",
            }}
          >
            SCREENMATE could not load
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "#8a8a98", margin: 0 }}>
            The agent never acts on a page it failed to read, so nothing was
            changed.
            {error.digest ? ` Reference ${error.digest}.` : ""}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              background: "#7c6cf5",
              color: "#fff",
              border: 0,
              borderRadius: 8,
              padding: "9px 18px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
