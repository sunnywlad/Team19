import { MongoMemoryServer } from 'mongodb-memory-server';
const m = await MongoMemoryServer.create({ instance: { port: 27018, dbPath: new URL('./data', import.meta.url).pathname, storageEngine: 'wiredTiger' } });
console.log('mongo up', m.getUri());
setInterval(() => {}, 1 << 30);
