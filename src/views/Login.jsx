import React, { useState } from 'react';

// Invite-only sign in: we email a link and a 6-digit code. The code works even when the
// email is opened on a different device than the one signing in.
export default function Login({ supabase, notice }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    setBusy(false);
    if (error) setErr(/signups not allowed|not found|otp_disabled/i.test(error.message) ? "This email doesn't have access. Ask Matt to add you." : error.message);
    else setSent(true);
  };

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setErr('That code did not work. Check it, or request a new one.');
  };

  return (
    <div className="login">
      <div className="card login-card">
        <h1>Project Costing</h1>
        <p className="muted">Aloha Technology</p>
        {notice && <div className="warnbox">{notice}</div>}
        {!sent ? (
          <form onSubmit={send}>
            <label>
              Work email
              <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@alohatechnology.com" />
            </label>
            <button className="primary" disabled={busy}>
              Email me a sign-in link
            </button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p>
              We sent an email to <strong>{email}</strong>. Click the link in it, or enter the 6-digit code here.
            </p>
            <label>
              Code
              <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            </label>
            <div className="row">
              <button className="primary" disabled={busy || code.trim().length < 6}>
                Sign in
              </button>
              <button type="button" className="small" onClick={() => setSent(false)}>
                Use a different email
              </button>
            </div>
          </form>
        )}
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
