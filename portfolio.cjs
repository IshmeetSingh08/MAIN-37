module.exports = function portfolio(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, units INTEGER NOT NULL, heating TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolio_tasks (
      id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES portfolio(id), title TEXT NOT NULL, status TEXT NOT NULL
    );
  `);
  const property = db.prepare('INSERT OR IGNORE INTO portfolio VALUES (?, ?, ?, ?, ?)');
  property.run('aachen-12', 'Musterstraße 12', 'Musterstraße 12, 52062 Aachen', 1, 'Gas central heating');
  property.run('lindenhof', 'Lindenhof', 'Lindenweg 8, 52074 Aachen', 8, 'District heating');
  property.run('parkblick', 'Parkblick', 'Parkstraße 24, 52066 Aachen', 12, 'Heat pump');
  const task = db.prepare('INSERT OR IGNORE INTO portfolio_tasks VALUES (?, ?, ?, ?)');
  task.run('hist-01', 'aachen-12', 'Annual heating service', 'Completed');
  task.run('hist-02', 'lindenhof', 'Entrance door adjusted', 'Completed');
  task.run('hist-03', 'parkblick', 'Heat pump filter replaced', 'Completed');
  task.run('task-02', 'lindenhof', 'Stairwell light inspection', 'Scheduled');
  task.run('task-03', 'parkblick', 'Garage door inspection', 'Awaiting provider');
  const properties = db.prepare('SELECT * FROM portfolio ORDER BY rowid');
  const tasks = db.prepare('SELECT * FROM portfolio_tasks WHERE property_id = ? ORDER BY id');
  return () => properties.all().map(item => ({ ...item, tasks: tasks.all(item.id) }));
};
