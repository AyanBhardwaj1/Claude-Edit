import type { Metadata, Viewport } from "next";
import { Mark } from "@/components/Icons";
import "../site.css";

export const viewport: Viewport = { themeColor: "#ffffff" };
export const metadata: Metadata = { title: "How your data is kept · Cutmind" };

export default function Privacy() {
  return (
    <div className="site">
      <div className="doc">
        <a className="wordmark" href="/" translate="no"><Mark />Cutmind</a>
        <main>
          <h1>How your data is kept</h1>
          <p>Cutmind is a video editor that runs in your browser. There is no Cutmind database: everything below lives on your computer unless a line
            says otherwise.</p>
          <h2>Your videos</h2>
          <p>Takes, songs, pictures and every version you make are kept in your browser&apos;s storage (IndexedDB) on this computer. They are never
            uploaded to Cutmind. Deleting a video in My videos removes it; clearing this site&apos;s data in your browser removes everything.</p>
          <h2>Your account</h2>
          <p>Your name, email and a salted PBKDF2 hash of your password are kept in this browser&apos;s storage. The password itself is never stored or
            sent anywhere. Accounts keep the videos, keys and style of different people on the same computer apart; they don&apos;t sync between devices.</p>
          <h2>Your API keys</h2>
          <p>Keys are sent only from your browser straight to Anthropic or OpenAI. They are forgotten when you close the tab, unless you tick
            &ldquo;Remember my keys&rdquo;, which keeps them in this browser&apos;s storage.</p>
          <h2>What goes to your AI provider</h2>
          <p>With OpenAI listening, the sound of your takes goes to OpenAI to be transcribed. To edit, the transcript text, your file names and your saved
            style rules go to the provider you chose. With in-browser listening and no key, nothing leaves your computer.</p>
          <h2>What Cutmind&apos;s server does</h2>
          <p>Two things: it searches Openverse, Wikimedia Commons and Simple Icons for open-licence pictures of words in your video, and it fetches those
            pictures from a fixed list of hosts so they can be drawn into the reel. The search words come from your transcript; nothing else is sent.</p>
          <p style={{ marginTop: 48 }}><a className="textlink" href="/">Back to the home page</a></p>
        </main>
      </div>
    </div>
  );
}
