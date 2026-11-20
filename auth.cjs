const { randomBytes, scryptSync, timingSafeEqual, createHash } = require('node:crypto');
const ttl = 8 * 60 * 60;
const digest = value => createHash('sha256').update(value).digest('hex');
const cookie = (value, age = ttl) => 'centrix_session=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age;

module.exports = function auth(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL,
      role TEXT NOT NULL, provider_id TEXT, salt TEXT, verifier TEXT, demo INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);
  `);
  const byEmail = db.prepare('SELECT * FROM accounts WHERE email = ?');
  const byId = db.prepare('SELECT * FROM accounts WHERE id = ?');
  const insert = db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const remove = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const lookup = db.prepare('SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires>?');
  function token(header = '') {
    return /(?:^|;\s*)centrix_session=([a-f0-9]{64})(?:;|$)/.exec(header)?.[1];
  }
  function logout(header) {
    const old = token(header);
    if (old) remove.run(digest(old));
    return cookie('', 0);
  }
  return {
    byEmail: email => byEmail.get(email),
    register(id, email, name, role, password, providerId = null) {
      const salt = randomBytes(16).toString('hex');
      insert.run(id, email, name, role, providerId, salt, scryptSync(password, salt, 64).toString('hex'), 0);
    },
    demo(id, name, role, providerId = null) {
      const accountId = 'demo:' + id;
      if (!byId.get(accountId)) insert.run(accountId, null, name, role, providerId, null, null, 1);
      return byId.get(accountId);
    },
    verify(account, password) {
      const actual = scryptSync(password, account?.salt ?? 'invalid-account-salt', 64);
      return timingSafeEqual(actual, account?.verifier ? Buffer.from(account.verifier, 'hex') : Buffer.alloc(64))
        && Boolean(account?.verifier);
    },
    login(account, header) {
      logout(header);
      const value = randomBytes(32).toString('hex');
      db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(value), account.id, Date.now() + ttl * 1000);
      return cookie(value);
    },
    read(header) {
      const value = token(header);
      const account = value && lookup.get(digest(value), Date.now());
      return account ? { ...account, providerId: account.provider_id } : null;
    },
    logout
  };
};
