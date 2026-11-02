"use client";
import { useEffect, useRef, useState } from "react";
import { Mark } from "@/components/Icons";
import { AuthError, currentUser, passwordProblem, signIn, signUp, validEmail } from "@/lib/auth";
import "../site.css";

type Field = "name" | "email" | "password";

export default function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [next, setNext] = useState("/app");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Partial<Record<Field | "form", string>>>({});
  const refs = { name: useRef<HTMLInputElement>(null), email: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null) };

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const n = q.get("next");
    const safe = n && n.startsWith("/app") ? n : "/app";
    if (currentUser()) { location.replace(safe); return; }
    setNext(safe);
    setMode(q.get("mode") === "signup" ? "signup" : "signin");
    document.title = q.get("mode") === "signup" ? "Create your account · Cutmind" : "Sign in · Cutmind";
  }, []);

  function swap(m: "signin" | "signup") {
    setMode(m); setErrs({});
    const q = new URLSearchParams(location.search);
    if (m === "signup") q.set("mode", "signup"); else q.delete("mode");
    history.replaceState(null, "", `/login${q.toString() ? `?${q}` : ""}`);
    document.title = m === "signup" ? "Create your account · Cutmind" : "Sign in · Cutmind";
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? ""), email = String(f.get("email") ?? ""), password = String(f.get("password") ?? "");
    const remember = f.get("remember") === "on";
    const found: Partial<Record<Field, string>> = {};
    if (mode === "signup" && !name.trim()) found.name = "Tell us what to call you.";
    if (!validEmail(email)) found.email = "Enter an email like you@example.com.";
    if (!password) found.password = "Enter a password.";
    else if (mode === "signup") { const bad = passwordProblem(password); if (bad) found.password = bad; }
    setErrs(found);
    const first = (["name", "email", "password"] as Field[]).find((k) => found[k]);
    if (first) { refs[first].current?.focus(); return; }
    setBusy(true);
    try {
      if (mode === "signup") await signUp(name, email, password, remember); else await signIn(email, password, remember);
      location.assign(next);
    } catch (err) {
      const a = err instanceof AuthError ? err : new AuthError(String(err));
      setErrs(a.field ? { [a.field]: a.message } : { form: a.message });
      if (a.field) refs[a.field].current?.focus();
      setBusy(false);
    }
  }

  const up = mode === "signup";
  const err = (k: Field) => errs[k] ? <span className="err" id={`${k}-err`}>{errs[k]}</span> : null;
  return (
    <div className="site">
      <div className="auth">
        <div className="form-side">
          <a className="wordmark" href="/" translate="no"><Mark />Cutmind</a>
          <main className="form-wrap">
            <h1>{up ? "Make your account" : "Welcome back"}</h1>
            <p className="sub">{up ? "Two minutes from now you can drop in your first take." : "Sign in to your videos, your keys and your style."}</p>
            <div className="switch" role="group" aria-label="Sign in or create an account">
              <a href="/login" aria-current={!up ? "page" : undefined} onClick={(e) => { e.preventDefault(); swap("signin"); }}>Sign in</a>
              <a href="/login?mode=signup" aria-current={up ? "page" : undefined} onClick={(e) => { e.preventDefault(); swap("signup"); }}>Create an account</a>
            </div>
            <form onSubmit={submit} noValidate>
              {up && (
                <div className="f">
                  <label htmlFor="name">Your name</label>
                  <input ref={refs.name} id="name" name="name" type="text" autoComplete="name" placeholder="Priya Raman…" aria-invalid={!!errs.name}
                    aria-describedby={errs.name ? "name-err" : undefined} />
                  {err("name")}
                </div>
              )}
              <div className="f">
                <label htmlFor="email">Email</label>
                <input ref={refs.email} id="email" name="email" type="email" inputMode="email" autoComplete={up ? "email" : "username"} spellCheck={false}
                  placeholder="you@example.com…" aria-invalid={!!errs.email} aria-describedby={errs.email ? "email-err" : undefined} />
                {err("email")}
              </div>
              <div className="f">
                <label htmlFor="password">Password</label>
                <div className="pw">
                  <input ref={refs.password} id="password" name="password" type={show ? "text" : "password"} autoComplete={up ? "new-password" : "current-password"}
                    aria-invalid={!!errs.password} aria-describedby={errs.password ? "password-err" : up ? "pw-hint" : undefined} />
                  <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? "Hide password" : "Show password"}>{show ? "Hide" : "Show"}</button>
                </div>
                {err("password") ?? (up && <span className="hint" id="pw-hint">At least 8 characters, with a number or a symbol.</span>)}
              </div>
              <label className="chk"><input type="checkbox" name="remember" defaultChecked />Keep me signed in on this computer</label>
              {errs.form && <p className="err" role="alert">{errs.form}</p>}
              <button className="act ink" type="submit" disabled={busy}>
                {busy ? <><span className="spin" aria-hidden="true" />{up ? "Making your account…" : "Signing in…"}</> : up ? "Create my account" : "Sign in"}
              </button>
            </form>
            <p className="fine" aria-live="polite">
              {up ? "Your account lives in this browser, like your videos. Cutmind has no server copy of your videos, keys or password; it stores only a salted hash of the password here."
                : "Forgot your password? Accounts live only in this browser, so there is no reset email: create a new account to keep going."}
            </p>
          </main>
          <a className="back textlink" href="/">Back to the home page</a>
        </div>
        <div className="art on-dark" aria-hidden="true">
          <div className="script">
            <p><s>Okay so. Um, the thing nobody tells you about editing is.</s></p>
            <p><s>Wait, let me try that again.</s></p>
            <p>The thing nobody tells you about editing is that it takes three hours for a one minute video.</p>
          </div>
          <div className="margin"><span><b>Retake.</b> The last complete take wins.</span><span><b>Meta-talk.</b> Said to yourself, not the viewer.</span></div>
          <div className="caps"><span>THE THING NOBODY</span><span>TELLS YOU ABOUT</span><span>EDITING IS THAT</span><span>IT TAKES 3</span></div>
        </div>
      </div>
    </div>
  );
}
