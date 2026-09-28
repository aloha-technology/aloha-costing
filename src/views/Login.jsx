import React, { useState } from 'react';

// Invite-only sign in with email + password. Matt creates accounts and sends starting
// passwords on WhatsApp; there is no self sign-up and no email sending.
export default function Login({ supabase, notice }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const signIn = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (error) setErr(/invalid login credentials/i.test(error.message) ? 'Email or password is wrong. If you forgot your password, ask Matt for a new one.' : error.message);
  };

  return (
    <div className="login">
      <div className="card login-card">
        <h1>Project Costing</h1>
        <p className="muted">Aloha Technology</p>
        {notice && <div className="warnbox">{notice}</div>}
        <form onSubmit={signIn}>
          <label>
            Work email
            <input type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@alohatechnology.com" />
          </label>
          <label>
            Password
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="primary" disabled={busy}>
            Sign in
          </button>
        </form>
        {err && <div className="err">{err}</div>}
        <p className="muted small-text">No account, or forgot your password? Ask Matt.</p>
      </div>
    </div>
  );
}

// Shown after signing in with a starting password, until the person picks their own.
export function ChangePassword({ supabase, me, onSignOut, onDone, required }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    if (pw.length < 10) return setErr('Use at least 10 characters.');
    if (pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.updateUser({ password: pw, data: { must_change_password: false } });
    setBusy(false);
    if (error) setErr(/different from the old/i.test(error.message) ? 'Choose a password different from the current one.' : error.message);
    else onDone?.();
  };

  return (
    <div className="login">
      <div className="card login-card">
        <h1>Choose your password</h1>
        <p className="muted">
          {required ? `Welcome, ${me?.name || ''}. Replace the starting password you were sent with one only you know.` : 'Set a new password.'}
        </p>
        <form onSubmit={save}>
          <label>
            New password (at least 10 characters)
            <input type="password" required autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          <label>
            Type it again
            <input type="password" required autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </label>
          <button className="primary" disabled={busy}>
            Save password
          </button>
        </form>
        {err && <div className="err">{err}</div>}
        <button className="linkish" onClick={required ? onSignOut : onDone}>
          {required ? 'Sign out' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
