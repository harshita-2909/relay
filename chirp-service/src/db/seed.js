// The made-up people of Chirp, plus one starter post so the brief's story can begin right away.
export const PEOPLE = [
  { id: 'asha', name: 'Asha', bio: 'Photographer. Chasing sunsets.', color: '#e11d48' },
  { id: 'rahul', name: 'Rahul', bio: 'Coffee, code, cricket.', color: '#2563eb' },
  { id: 'meera', name: 'Meera', bio: 'Plant parent and bookworm.', color: '#059669' },
  { id: 'dev', name: 'Dev', bio: 'Always on a trail somewhere.', color: '#d97706' },
];

export function seed(db) {
  const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, name, bio, color) VALUES (?, ?, ?, ?)');
  for (const p of PEOPLE) insertUser.run(p.id, p.name, p.bio, p.color);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM posts').get();
  if (n === 0) {
    db.prepare('INSERT INTO posts (author_id, text, created_at) VALUES (?, ?, ?)')
      .run('asha', 'Caught this sunset at the beach today 🌅', new Date().toISOString());
  }
}
