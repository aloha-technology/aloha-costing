// Gives someone a new starting password (e.g. they forgot theirs).
//   npm run reset-password -- someone@alohatechnology.com
// The new password goes to data/new-passwords.txt only; they must change it on next sign-in.
import { adminClient, must, tempPassword, savePasswords } from './supabase-admin.mjs';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email.includes('@')) {
  console.error('Usage: npm run reset-password -- someone@alohatechnology.com');
  process.exit(1);
}

const supabase = adminClient();
let user = null;
for (let page = 1; !user; page++) {
  const { users } = must(await supabase.auth.admin.listUsers({ page, perPage: 1000 }), 'List logins');
  user = users.find((u) => (u.email || '').toLowerCase() === email) || null;
  if (users.length < 1000) break;
}
if (!user) {
  console.error(`No login for ${email}. Add them with "npm run users -- --apply" first.`);
  process.exit(1);
}

const password = tempPassword();
must(
  await supabase.auth.admin.updateUserById(user.id, { password, user_metadata: { ...user.user_metadata, must_change_password: true } }),
  'Reset password'
);
console.log(`New starting password for ${email} saved to ${savePasswords([{ email, password }])} (not shown here).`);
