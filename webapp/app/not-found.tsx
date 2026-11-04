import { Mark } from "@/components/Icons";
import "./site.css";

export default function NotFound() {
  return (
    <div className="site">
      <div className="doc">
        <a className="wordmark" href="/" translate="no"><Mark />Cutmind</a>
        <main>
          <h1>This page was cut</h1>
          <p>There&apos;s nothing at this address. Your videos are in the app, and everything else starts on the home page.</p>
          <p className="err-acts">
            <a className="act" href="/app">Open my videos</a><a className="act ink" href="/">Home page</a></p>
        </main>
      </div>
    </div>
  );
}
