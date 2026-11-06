import type { Metadata, Viewport } from "next";
import { Mark } from "@/components/Icons";
import { LiveBoard } from "@/components/site/LiveBoard";
import { LoopVideo } from "@/components/site/LoopVideo";
import { Reveal } from "@/components/site/Reveal";
import "./site.css";

export const metadata: Metadata = { title: "Cutmind: you talk, it cuts" };
export const viewport: Viewport = { themeColor: "#f5f5f5" };

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const d = (i: number) => ({ ["--i" as string]: i }) as React.CSSProperties;

const FEATURES = [
  { h: "Subtitles on every word", p: "Two or three words at a time, timed to your voice, in five styles and any Google Font. Numbers you say become digits, and you can fix any word it misheard.", pic: "w240", frag: "caps" },
  { h: "Pictures that miss your face", p: "Name an app, a brand or a place and its logo or photo appears on those words: from your own files first, then open-licence pictures it finds and credits. They sit above your head, beside you or in a phone, never across your eyes and mouth.", pic: "w320", frag: "frame" },
  { h: "Music under your voice", p: "It listens to your songs, picks one by mood, starts it a beat before the first hit, dips it under every word and lifts it in the pauses. No song? Make music composes an original one in your browser, in four moods, with a final chord that rings out as your video ends.", pic: "w180", frag: "music" },
  { h: "Your app, framed", p: "Drop in screenshots or a screen recording of your app and Cutmind recognises them: each one sits on a soft backdrop with rounded corners, pushes in slowly and punches in on the button you're talking about. On a reel it takes the top of the frame, above you, never over your face.", pic: "w240", frag: "screens" },
  { h: "Fast, or your best", p: "Pick Fast when you need it now, Balanced for the full edit, or Best quality for a second pass where your AI editor reviews its own cut like a senior editor. Each shows how long it takes on your computer, and the estimate learns from every video you make.", pic: "w180", frag: "speed" },
  { h: "One long video, five reels", p: "Drop in a podcast, a talk or a long take. Your AI editor reads all of it, ranks the moments that stand on their own and turns each into its own finished reel.", pic: "w320", frag: "clips" },
  { h: "Subtitles in 16 languages", p: "Translate the subtitles into Spanish, Hindi, Japanese and 13 more, line by line on the words they cover, then fix any line. A subtitle file comes with every export.", pic: "w180", frag: "lang" },
  { h: "A score before you post", p: "The reel check grades the hook, the pace, how often the picture changes, the length, the subtitles and the caption, out of 100, and says exactly what to fix.", pic: "w180", frag: "score" },
  { h: "A caption ready to post", p: "A hook line people search for, a sentence of context, credits for every picture and exactly five hashtags. The cover is the frame where your face says the most.", pic: "w240", frag: "post" },
] as const;

const FAQ: [string, string][] = [
  ["Can I make a video without filming?", "Yes. In Animate, type or paste anything and Motion Studio turns it into an animated video: kinetic type, counters, lists, charts and a closing card in your colours, with music and an AI voice if you want them."],
  ["Can it turn a podcast into clips?", "Yes. Drop in the long video and press Find the best clips: your AI editor ranks the moments that stand on their own, and each becomes its own edited reel."],
  ["Does my video get uploaded?", "No. Cutmind runs in your browser and keeps your videos in its storage on your computer. With OpenAI listening, only the sound goes to OpenAI to be transcribed; with in-browser listening, nothing leaves at all."],
  ["Do I need an API key?", "No. Without one you still get the cut and the subtitles. An Anthropic or OpenAI key adds the AI editor: best takes, hook title, pictures, music, notes and your caption."],
  ["What does it cost?", "Cutmind is free. Your provider bills your key for what you use: transcription with OpenAI is about $0.006 a minute, and an edit is a few cents."],
  ["Is my key safe?", "It goes straight from your browser to Anthropic or OpenAI, never to Cutmind’s server. It is forgotten when you close the tab unless you tick “Remember my keys”."],
  ["Does my account work on other devices?", "Yes: sign in anywhere and your settings, style rules and look come with you. Your videos and API keys stay in the browser you made them in. On a copy of Cutmind with no database, accounts live in one browser instead."],
  ["Which browsers work?", "Chrome, Edge and Safari export MP4. Firefox works too and exports WebM. Export plays the reel once in real time, so a 60-second reel takes about a minute."],
  ["Will it cut my jokes?", "It shouldn’t: asides and opinions are the video. If it does, write “it cut my joke” and the next version puts it back."],
  ["Can I use my own music and pictures?", "Yes, drop them in with your take or add them later. Only use music and pictures you own or are licensed to use. With no song, Make music composes an original, royalty-free one for the video, with no key and nothing uploaded."],
  ["Where do found pictures come from?", "Openverse, Wikimedia Commons and Simple Icons, under CC0, public domain, CC BY or CC BY-SA, with the credit written into your caption."],
  ["My video looks mirrored.", "Tick “Flip picture” in Edit it myself, or just tell your editor “it’s mirrored”."],
  ["Does it learn how I like things?", "When a note sounds like a lasting preference, it asks whether to remember it. Remembered rules shape every first edit after that."],
];

export default function Landing() {
  return (
    <div className="site">
      <Reveal />
      <a className="skip" href="#main">Skip to content</a>

      <header className="hero">
        <div className="talk">
          <a className="wordmark" href="/" translate="no"><Mark />Cutmind</a>
          <div className="say">
            <p>Drop in your raw takes, or just type. Cutmind keeps your best take of every line and hands back a finished reel.</p>
            <div className="acts"><a className="act" href="/login?mode=signup">Make your first reel<Arrow /></a>
              <a className="textlink" href="/login?mode=signup&amp;next=%2Fapp%23sample">or try the sample video first</a></div>
          </div>
        </div>
        <div className="wide">
          <nav aria-label="Main">
            <a href="#how">How it cuts</a><a href="#animate">Animate</a><a href="#price">Price</a><a className="signin" href="/login">Sign in</a>
          </nav>
          <h1><span className="ln"><span>You talk.</span></span><span className="ln"><span>It cuts.</span></span></h1>
          <div className="shot">
            <div className="fact"><b>0 MB</b><span>of your video is uploaded. It stays in your browser.</span></div>
            <div className="ui" data-ui role="img" aria-label="The Cutmind editor: a note asking for quieter music, and Version 2 with the music turned down">
              <div className="ui-editor">
                <div className="pnl">
                  <h4>Notes for your editor</h4>
                  <div className="bub them"><small>Your editor</small>I kept your last take of each line, cut 41 seconds of pauses and added your song.</div>
                  <div className="bub you"><small>You</small>music too loud at the start</div>
                  <div className="bub them"><small>Your editor</small>Version 2: I turned the music down under your first two lines.</div>
                  <div className="vers"><span>Version 1</span><span className="on">Version 2</span></div>
                </div>
                <div className="pnl">
                  <h4>What I did</h4>
                  <ul className="did"><li>Kept your best takes · 0:58 long</li><li>Added subtitles</li><li>Added music: morning-walk.mp3</li>
                    <li>6 pictures and 2 text cards</li><li>5 zooms</li><li>Wrote your post caption</li></ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="board-sec on-dark" id="how" aria-label="Try the cut">
          <LiveBoard />
        </section>

        <section className="feat" aria-labelledby="feat-h">
          <div className="lead-in"><h2 id="feat-h" data-reveal>Then it finishes the reel</h2></div>
          <div className="rows">
            {FEATURES.map((f) => (
              <article key={f.h} className="row">
                <div className="txt"><h3 data-reveal>{f.h}</h3><p data-reveal style={d(1)}>{f.p}</p></div>
                <div className={`pic ${f.pic} ui`} data-ui data-reveal style={d(2)} role="img" aria-label={`Cutmind: ${f.h.toLowerCase()}`}>
                  {f.frag === "caps" && <div className="frag-caps"><div className="c">HERE ARE THE</div><div className="c bold">3 TOOLS <em>I USE</em></div>
                    <div className="c boxed"><span>EVERY DAY</span></div><div className="c minimal">for every video</div><div className="c yellow">$20 A MONTH</div></div>}
                  {f.frag === "frame" && <div className="frag-frame"><div className="card">Spotify logo · CC0</div>
                    <div className="zone">eyes to chin<br />kept clear</div><div className="cap">I USE SPOTIFY</div><div className="tag">Picture above your head</div></div>}
                  {f.frag === "music" && <div className="frag-music"><div className="song on"><i />morning-walk.mp3<em>steady</em></div>
                    <div className="song"><i />late-drive.wav<em>driving</em></div><div className="song"><i />rain-room.mp3<em>gentle</em></div>
                    <div className="lvl" aria-hidden="true">{[70, 74, 30, 26, 28, 72, 75, 31, 27, 70, 68, 29, 25, 26, 74, 78].map((h, i) =>
                      <i key={i} className={h < 40 ? "" : "v"} style={{ height: `${h}%` }} />)}</div></div>}
                  {f.frag === "screens" && <div className="frag-screens"><div className="scr"><i className="hd" /><i className="l1" /><i className="l2" />
                    <i className="btn" /><span className="ring" aria-hidden="true" /></div><div className="cap">tap Plan my walk</div></div>}
                  {f.frag === "speed" && <div className="frag-speed">{[["Fast", "about 1 min", ""], ["Balanced", "about 3 min", "on"], ["Best quality", "about 5 min", ""]].map(([n, t, on]) => (
                    <div key={n} className={`opt ${on}`}><i />{n}<em>{t} on this computer</em></div>))}</div>}
                  {f.frag === "clips" && <div className="frag-clips">{[["9", "The 3 hour edit I quit", "0:48"], ["8", "Why intros lose viewers", "0:36"], ["7", "My Sunday batching day", "1:02"]].map(([sc, t, d]) => (
                    <div key={t} className="clip"><b>{sc}</b><span>{t}<em>{d} · ready to edit</em></span></div>))}</div>}
                  {f.frag === "lang" && <div className="frag-lang"><div className="c">THE ONE HABIT</div><div className="c es">EL ÚNICO HÁBITO</div><div className="c hi">एक आदत</div><div className="c ja">たった一つの習慣</div></div>}
                  {f.frag === "score" && <div className="frag-score"><div className="ring-s"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" className="bg" />
                    <circle cx="50" cy="50" r="42" className="fg" strokeDasharray="242.8 264" /></svg><b>92</b></div><ul>
                    <li>Hook from the first word</li><li>183 words a minute</li><li className="no">5.2 s without a change</li></ul></div>}
                  {f.frag === "post" && <div className="frag-post"><div className="box">The 20 minute edit that replaced my 3 hour one. I talk once,
                    it keeps my best take and adds the rest. Try it on your next video.<br /><br /><span className="tags">#reelsediting #talkinghead
                    #contentcreatortips #videoworkflow #smallcreator</span></div></div>}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="styles-sec" id="motion" aria-labelledby="motion-h">
          <div className="say">
            <h2 id="motion-h" data-reveal>Seven styles that move</h2>
            <p data-reveal style={d(1)}>Karaoke words, bounces, typewriters, whip pans, glitch cuts, colour grades and pictures that slide in. One click
              applies a whole style; your AI editor picks one to fit the video.</p>
          </div>
          <div className="strip">
            {[["style-karaoke", "Karaoke", "The spoken word lit on a colour box"], ["style-neon", "Neon", "Pink highlights and a glitch cut"],
              ["style-punchy", "Punchy", "Heavy words that bounce in"], ["style-cinematic", "Cinematic", "A teal grade, typewriter words"]].map(([f, n, alt], i) => (
              <figure key={f} className="t" data-reveal style={d(i)}><img src={`/shots/${f}.webp`} width={540} height={960} loading="lazy"
                alt={`A frame in the ${n} style: ${alt.toLowerCase()}, on Cutmind's drawn sample presenter`} /><figcaption>{n}</figcaption></figure>))}
          </div>
        </section>

        <section className="anim-sec" id="animate" aria-labelledby="anim-h">
          <div className="grid">
            <div className="say">
              <h2 id="anim-h" data-reveal>Or skip the camera</h2>
              <p data-reveal style={d(1)}>Type a script, paste a link or five bullet points. Motion Studio turns it into kinetic type, counters, lists, charts,
                pictures and a closing card, in your colours, calm or hype, read by an AI voice if you like.</p>
              <div data-reveal style={d(2)}><a className="act ink" href="/login?mode=signup&amp;next=%2Fapp%23animate">Animate some text<Arrow /></a></div>
            </div>
            <figure className="t big"><LoopVideo src="/shots/anim-loop.mp4" poster="/shots/anim-loop.webp" width={720} height={720}
              label="An animation Motion Studio made from five lines of text" /><figcaption>Made from 7 lines of text</figcaption></figure>
            {[["anim-title", "A title with an accent sweep"], ["anim-number", "A milestone, counted"], ["anim-list", "A list that ticks in"],
              ["anim-compare", "Before and after"], ["anim-paper", "The Paper palette"], ["anim-electric", "The Electric palette"]].map(([f, alt]) => (
              <figure key={f} className="t"><img src={`/shots/${f}.webp`} width={540} height={960} loading="lazy" alt={`Motion Studio: ${alt.toLowerCase()}`} /></figure>))}
          </div>
        </section>

        <section className="looks" id="looks" aria-labelledby="looks-h">
          <div className="grid">
            <div className="say">
              <h2 id="looks-h" data-reveal>Five looks for the app</h2>
              <p data-reveal style={d(1)}>Studio, Radiant, Terminal, Ivory and Natural. Pick one from the sidebar and the whole editor changes with you.</p>
            </div>
            <figure className="t a"><LoopVideo src="/shots/looks.mp4" poster="/shots/look-studio.webp" label="The Cutmind home screen in each of its five looks, one after another" /><figcaption>All five, in turn</figcaption></figure>
            <figure className="t b"><img src="/shots/look-radiant.webp" width={1440} height={900} loading="lazy" alt="The Cutmind home screen in the Radiant look: white with electric blue" /><figcaption>Radiant</figcaption></figure>
            <figure className="t c"><img src="/shots/look-terminal.webp" width={1440} height={900} loading="lazy" alt="The Cutmind home screen in the Terminal look: black with green monospace type" /><figcaption>Terminal</figcaption></figure>
            <figure className="t d"><img src="/shots/look-ivory.webp" width={1440} height={900} loading="lazy" alt="The Cutmind home screen in the Ivory look: warm paper with serif headings" /><figcaption>Ivory</figcaption></figure>
            <figure className="t e"><img src="/shots/look-natural.webp" width={1440} height={900} loading="lazy" alt="The Cutmind home screen in the Natural look: sage and moss green" /><figcaption>Natural</figcaption></figure>
            <div className="f"><p data-reveal>The reel itself never changes with the look: what you export is the same.</p></div>
          </div>
        </section>

        <section className="stages" aria-labelledby="stages-h">
          <h2 id="stages-h" data-reveal>Three minutes, take to post</h2>
          <div className="bar" data-ui data-reveal role="img" aria-label="For a 60-second reel: drop your files in seconds, listening takes under a minute, the first edit about half a minute, export about a minute">
            <div className="s1" style={{ flexGrow: 5 }}>Seconds</div>
            <div className="s2" style={{ flexGrow: 40 }}>Under a minute</div>
            <div className="s3" style={{ flexGrow: 30 }}>About half a minute</div>
            <div className="s4" style={{ flexGrow: 60 }}>About a minute</div>
          </div>
          <div className="bar-notes" aria-hidden="true">
            <p style={{ flexGrow: 5 }}><span>First, drop your takes, songs and pictures.</span></p>
            <p style={{ flexGrow: 40 }}><span>Then it listens and finds every retake.</span></p>
            <p style={{ flexGrow: 30 }}><span>Next, your editor plans the cut, pictures and music.</span></p>
            <p style={{ flexGrow: 60 }}><span>Last, it plays the reel once to record your MP4.</span></p>
          </div>
          <div className="vbar">
            <div className="s1" style={{ background: "var(--f1)", minHeight: 72 }}><b>Seconds</b><span>First, drop your takes, songs and pictures.</span></div>
            <div style={{ background: "var(--f2)", minHeight: 180 }}><b>Under a minute</b><span>Then it listens and finds every retake.</span></div>
            <div style={{ background: "var(--f3)", minHeight: 140 }}><b>About half a minute</b><span>Next, your editor plans the cut, pictures and music.</span></div>
            <div style={{ background: "var(--f4)", color: "#fff", minHeight: 260 }}><b>About a minute</b><span>Last, it plays the reel once to record your MP4.</span></div>
          </div>
        </section>

        <section className="names" aria-labelledby="names-h">
          <h2 id="names-h" data-reveal>Works with</h2>
          <div className="cols" data-reveal style={d(1)}>
            <ul><li>Your editor</li><li>Anthropic</li><li>OpenAI</li></ul>
            <ul><li>Listening</li><li>OpenAI transcription</li><li>Whisper in your browser</li></ul>
            <ul><li>Pictures from</li><li>Your own files</li><li>Openverse</li><li>Wikimedia Commons</li><li>Simple Icons</li></ul>
            <ul><li>Made for</li><li>Instagram Reels</li><li>TikTok</li><li>YouTube Shorts</li><li>Facebook Reels</li></ul>
            <ul><li>Runs in</li><li>Chrome</li><li>Edge</li><li>Safari</li><li>Firefox</li></ul>
          </div>
        </section>

        <section className="plans" id="price" aria-labelledby="price-h">
          <table data-reveal>
            <thead>
              <tr>
                <th scope="col"><h2 id="price-h">Free to use</h2></th>
                <th scope="col"><b>No key</b><span className="price">$0</span><span className="per">nothing to set up</span></th>
                <th scope="col" className="rec"><b>Anthropic key</b><span className="price">$0</span><span className="per">plus what your key uses</span></th>
                <th scope="col"><b>OpenAI key</b><span className="price">$0</span><span className="per">plus what your key uses</span></th>
              </tr>
            </thead>
            <tbody>
              {PLAN_ROWS.map(([what, a, b, c]) => (
                <tr key={what}><th scope="row">{what}</th><td>{a}</td><td className="rec">{b}</td><td>{c}</td></tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td /><td><a className="act ink" href="/login?mode=signup">Start free</a></td>
                <td className="rec"><a className="act ink" href="/login?mode=signup">Start with Anthropic</a></td>
                <td><a className="act ink" href="/login?mode=signup">Start with OpenAI</a></td></tr>
            </tfoot>
          </table>
          <div className="plan-cards">
            <h2>Free to use</h2>
            {(["No key", "Anthropic key", "OpenAI key"] as const).map((name, k) => (
              <article key={name} className={k === 1 ? "rec" : ""}>
                <h3>{name}</h3><p className="price">$0</p><p>{k ? "plus what your key uses" : "nothing to set up"}</p>
                <dl>{PLAN_ROWS.map((r) => <div key={r[0]}><dt>{r[0]}</dt><dd>{r[k + 1]}</dd></div>)}</dl>
                <a className="act ink" href="/login?mode=signup">{k === 0 ? "Start without a key" : k === 1 ? "Start with Anthropic" : "Start with OpenAI"}</a>
              </article>
            ))}
          </div>
          <p className="note">Have both keys? Choose who edits in Settings and let OpenAI do the listening. Your provider bills your key directly; Cutmind never
            sees the bill or the key.</p>
        </section>

        <section className="faq" aria-labelledby="faq-h">
          <h2 id="faq-h" data-reveal>Questions</h2>
          <div className="txt" data-reveal style={d(1)}>
            {FAQ.map(([q, a]) => <p key={q}><b>{q}</b> {a}</p>)}
          </div>
        </section>

        <section className="close on-dark" aria-labelledby="close-h">
          <h2 id="close-h" data-reveal>Keep talking.<br />We&apos;ll cut.</h2>
          <div className="base">
            <p data-reveal style={d(1)}>Your first reel takes a raw take, a browser and about three minutes.</p>
            <a className="act" href="/login?mode=signup" data-reveal style={d(2)}>Make your first reel<Arrow /></a>
          </div>
        </section>
      </main>

      <footer className="foot on-dark">
        <div className="cols">
          <ul><li>Cutmind</li><li><a href="#how">How it cuts</a></li><li><a href="#motion">Styles</a></li><li><a href="#animate">Animate</a></li><li><a href="#looks">Five looks</a></li><li><a href="#price">Price</a></li></ul>
          <ul><li>Account</li><li><a href="/login">Sign in</a></li><li><a href="/login?mode=signup">Create an account</a></li></ul>
          <ul><li>Privacy</li><li>Videos stay in your browser</li><li>Keys go straight to your provider</li><li><a href="/privacy">How your data is kept</a></li></ul>
          <ul><li>Source</li><li><a href="https://github.com/AyanBhardwaj1/Claude-Edit">GitHub</a></li><li>Editing doctrine adapted from Reel Studio (MIT)</li></ul>
        </div>
        <div />
        <div>
          <svg className="big" viewBox="0 0 1000 205" role="img" aria-label="Cutmind">
            <text x="0" y="168" textLength="1000" lengthAdjust="spacingAndGlyphs" fontFamily="Literata, Georgia, serif" fontWeight={500} fontSize="210">Cutmind</text>
          </svg>
          <p className="legal">© 2026 Cutmind. Only use music and pictures you own or are licensed to use.</p>
        </div>
      </footer>
    </div>
  );
}

const PLAN_ROWS: [string, string, string, string][] = [
  ["The cut", "Your last complete take of each line", "An AI editor reads every word and keeps your jokes", "An AI editor reads every word and keeps your jokes"],
  ["Listening", "In your browser", "In your browser", "OpenAI, about $0.006 a minute"],
  ["Subtitles", "Five styles, any font", "Five styles, any font", "Five styles, any font"],
  ["Hook title, pictures, zooms, music", "Not included", "Planned for every line", "Planned for every line"],
  ["Changes by note", "Edit it yourself", "Write a note, get a version", "Write a note, get a version"],
  ["Post caption", "Not included", "Written, with 5 hashtags", "Written, with 5 hashtags"],
  ["Animate any text", "Your lines become scenes", "The AI plans the scenes", "The AI plans the scenes and can voice them"],
  ["Clips from long videos", "Not included", "Ranked and edited", "Ranked and edited"],
  ["Subtitles in other languages", "Not included", "16 languages", "16 languages"],
  ["AI pictures from a description", "Not included", "Not included", "A few cents a picture"],
  ["What leaves your computer", "Nothing", "The transcript text, to Anthropic", "The sound and transcript, to OpenAI"],
];
