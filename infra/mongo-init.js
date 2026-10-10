try {
  rs.status();
} catch (error) {
  if (error.code !== 94) throw error;
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] });
}
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (db.hello().isWritablePrimary) {
    print('Replica set is ready.');
    quit(0);
  }
  sleep(1000);
}
throw new Error('Replica set did not become writable within 60 seconds.');
