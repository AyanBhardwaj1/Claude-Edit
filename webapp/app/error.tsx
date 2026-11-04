"use client";
import { useEffect } from "react";
import "./site.css";

/** Any page that throws lands here instead of a blank screen. Videos are safe: they live in this browser's storage. */
export default function Failed({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="site">
      <div className="doc">
        <a className="wordmark" href="/" translate="no">Cutmind</a>
        <main>
          <h1>Something broke on this page</h1>
          <p>Your videos are safe: they&apos;re kept in this browser, not on this page. Try again, and if it keeps happening, reload the
            app from the home page.</p>
          <p className="err-detail">{error.message}</p>
          <p className="err-acts"><button className="act" onClick={reset}>Try again</button><a className="act ink" href="/app">Open my videos</a></p>
        </main>
      </div>
    </div>
  );
}
